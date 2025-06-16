<script>
export default {
    data() {
        return {
            folder: "",
            allFiles: [],
            jsonFiles: [],
            files: [],
            pairs: [],
            filteredPairs: [],
            loadingAllFiles: false,
            loadingPairs: false,
            loadingSetDates: false,
            updatingFileIndex: 1,
            finished: false,
        };
    },

    computed: {
        showOpenFolderBtn() {
            return !this.loadingAllFiles && !this.loadingPairs && this.folder === "";
        },
        showSetDatesContent() {
            return !this.loadingAllFiles && !this.loadingPairs && this.pairs.length > 0;
        },
        errorResults() {
            return this.pairs.filter((pair) => pair.result === false);
        },
        successResults() {
            return this.pairs.filter((pair) => pair.result === true);
        },
    },

    methods: {
        reset() {
            this.folder = "";
            this.allFiles = [];
            this.jsonFiles = [];
            this.files = [];
            this.pairs = [];
            this.filteredPairs = [];
            this.loadingAllFiles = false;
            this.loadingPairs = false;
            this.loadingSetDates = false;
            this.updatingFileIndex = 1;
            this.finished = false;
            console.log("Aplikácia bola resetovaná.");
        },

        async openFolder() {
            const folder = await window.electronAPI.selectFolder();
            if (!folder) return;

            this.loadingAllFiles = true;
            this.folder = folder;

            // Načítanie všetkých súborov z priečinka
            this.allFiles = await window.electronAPI.getFiles(folder);

            // --- Paralelné spracovanie JSON súborov ---
            this.jsonFiles = this.allFiles.filter((f) => f.name.endsWith(".json") && f.name !== "metadáta.json");

            const jsonPromises = this.jsonFiles.map(async (f) => {
                try {
                    const data = await window.electronAPI.readJsonFile(f.fullPath);
                    f.content = data;
                    // Používame f.content.title, ak existuje, inak f.name. Toto by malo byť spoľahlivejšie pre zobrazenie.
                    f.fileName = this.truncateTo46(f.content?.title || f.name);
                } catch (err) {
                    console.error(`Chyba pri čítaní JSON súboru ${f.name}:`, err);
                    // Nastavte content na null alebo prázdny objekt, ak chcete spracovať chybné JSONy
                    f.content = null;
                }
            });

            // Počkáme, kým sa dokončia VŠETKY JSON operácie
            await Promise.all(jsonPromises);

            // --- Paralelné spracovanie obrázkov a videí (EXIF dát) ---
            this.files = this.allFiles.filter(
                (f) => !f.name.endsWith(".json") && f.name !== "working" && f.name !== "success" && f.name !== "error"
            );

            this.loadingAllFiles = false;

            this.findPairs();
        },

        // Predpokladám, že túto funkciu máte definovanú
        truncateTo46(str) {
            if (!str) return "";
            return str.length > 46 ? str.substring(0, 43) + "..." : str;
        },

        removeExtension(filename) {
            const lastDotIndex = filename.lastIndexOf(".");
            if (lastDotIndex === -1) return filename; // ak nemá príponu, vrátime pôvodný string
            return filename.slice(0, lastDotIndex);
        },

        findPairs() {
            this.loadingPairs = true;
            this.pairs = [];
            this.filteredPairs = [];

            // Množina už spárovaných JSON názvov (obj1.name)
            const usedJsonTitles = new Set();
            // Množina už spárovaných súborových názvov (obj2.name)
            const usedFileTitles = new Set();

            // Pomocná funkcia na získanie "čistého" názvu pre párovanie
            // Kľúčové: správne spracovanie (1) suffixu a .supplemental-metadata
            // name: vstupný názov (napr. "DSC_0110.JPG.supplemental-metadata(1).json" alebo "DSC_0110(1).JPG")
            // isJsonOrigin: či názov pochádza z JSON súboru (používame to na špecifické spracovanie .json prípon a .supplemental-metadata)
            const getNormalizedPairingKey = (name, isJsonOrigin = false) => {
                if (!name) return "";
                let cleaned = name.toLowerCase();

                // 1. Odstráň '.json' príponu, ak je to JSON pôvod

                if (isJsonOrigin) {
                    cleaned = cleaned.replace(/\.json$/, "");
                }

                // 2. Odstráň '.supplemental-metadata'
                // Ak názov pred odstránením .supplemental-metadata končil na (1),
                // chceme to (1) zachovať pre finálny kľúč.
                let hasParenOneBeforeSupplementalMetadata = false;
                if (cleaned.includes(".supplemental-metadata") && cleaned.endsWith("(1)")) {
                    hasParenOneBeforeSupplementalMetadata = true;
                }

                cleaned = cleaned.replace(/\.supplemental-metadata/, ""); // Vždy odstráň '.supplemental-metadata'

                // 3. Odstráň príponu média (napr. .jpg, .png atď.)
                const mediaExtensionRegex = /\.(jpg|jpeg|png|gif|bmp|tiff|webp|mp4|mov|avi|webm|mkv|3gp|heic)$/;
                cleaned = cleaned.replace(mediaExtensionRegex, "");

                // 4. Uprav (1) suffix na základe pôvodného kontextu
                if (hasParenOneBeforeSupplementalMetadata && !cleaned.endsWith("(1)")) {
                    // Ak bol JSON s .supplemental-metadata(1), uistite sa, že finálny kľúč obsahuje (1)
                    cleaned += "(1)";
                } else {
                    // Pre bežné súbory ako "DSC_0110(1)" alebo JSON tituly ako "DSC_0110(1)"
                    // uistite sa, že (1) zostalo, ak tam bolo
                    // (už ho nemáme odstraňovať a znova pridávať, len ho skontrolujeme)
                    // Ak náhodou zmizlo kvôli regexu (čo by nemalo), tak by tu bola komplexnejšia logika.
                    // Ale ak regexy sú správne, tak (1) by už malo byť súčasťou 'cleaned'.
                }

                // Odstráňte akékoľvek koncové bodky, ktoré mohli zostať
                cleaned = cleaned.replace(/\.$/, "");

                return cleaned.trim();
            };

            // Vytvorenie mapy súborov pre rýchle vyhľadávanie
            // Kľúč: getNormalizedPairingKey(file.name)
            // Hodnota: Pole objektov súborov, ktoré majú rovnaký normalizovaný kľúč.
            // Dôležité: Zoradíme ich pre deterministické správanie (napr. (1) súbory skôr ako bez (1))
            const filesByPairingKey = new Map();
            for (const file of this.files) {
                const key = getNormalizedPairingKey(file.name);
                if (key.length > 0) {
                    if (!filesByPairingKey.has(key)) {
                        filesByPairingKey.set(key, []);
                    }
                    filesByPairingKey.get(key).push(file);
                }
            }
            // Zoradenie súborov v mapách, aby (1) verzie mali prioritu, ak majú rovnaký kľúč
            filesByPairingKey.forEach((fileList) => {
                fileList.sort((a, b) => {
                    const aBase = this.removeExtension(a.name);
                    const bBase = this.removeExtension(b.name);
                    if (aBase.endsWith("(1)") && !bBase.endsWith("(1)")) return -1;
                    if (!aBase.endsWith("(1)") && bBase.endsWith("(1)")) return 1;
                    return aBase.localeCompare(bBase);
                });
            });

            // Rýchle zoradenie JSON súborov
            this.jsonFiles.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            for (const obj1 of this.jsonFiles) {
                const title1 = obj1.name; // Používame obj1.name ako hlavný identifikátor pre JSON
                if (!title1 || usedJsonTitles.has(title1)) continue;

                let foundMatchForJson = false;

                // Získanie normalizovaného kľúča pre JSON súbor
                const jsonPairingKey = getNormalizedPairingKey(title1, true);

                // --- Fáza 1: Preferencia presnej zhody podľa normalizovaného kľúča ---
                // Vyhľadávame súbory, ktoré majú rovnaký normalizovaný kľúč ako JSON
                const potentialFiles = filesByPairingKey.get(jsonPairingKey) || [];

                for (const obj2 of potentialFiles) {
                    const title2 = obj2.name;
                    if (usedFileTitles.has(title2)) {
                        // Kontrola, či súbor už nie je spárovaný
                        continue;
                    }

                    // Kľúč by mal byť presne zhodný, ak funkcia getNormalizedPairingKey funguje správne
                    // Tu môžeme ešte pridať dodatočné kontroly, ak by bolo potrebné, ale ideálne je,
                    // aby kľúč už zabezpečil presnú zhodu.

                    this.pairs.push({ fromJsonArray: obj1, fromFilesArray: obj2 });
                    usedJsonTitles.add(title1);
                    usedFileTitles.add(title2);
                    foundMatchForJson = true;
                    break; // JSON spárovaný, prejsť na ďalší JSON
                }

                // --- Fáza 2: Záložná "includes" logika (bez ohľadu na (1) suffix) ---
                // Spustí sa len, ak Fáza 1 nenašla pár.
                if (!foundMatchForJson) {
                    // Pre túto fázu zjednodušíme kľúč odstránením aj (1) pre širšie porovnanie
                    const jsonCoreNameSimple = jsonPairingKey.replace(/\(\d+\)$/, "");

                    // Iterujeme cez všetky súbory (okrem už spárovaných)
                    for (const obj2 of this.files) {
                        const title2 = obj2.name;
                        if (usedFileTitles.has(title2)) {
                            // Kontrola, či súbor už nie je spárovaný
                            continue;
                        }

                        const filePairingKey = getNormalizedPairingKey(title2); // Pre súbor nie je isJsonOrigin = true
                        const fileCoreNameSimple = filePairingKey.replace(/\(\d+\)$/, "");

                        // Pôvodná includes logika: baseTitle.includes(baseName) || baseName.includes(baseTitle)
                        // Teraz na zjednodušených kľúčoch bez (1)
                        if (
                            jsonCoreNameSimple.length > 0 &&
                            fileCoreNameSimple.length > 0 &&
                            (jsonCoreNameSimple.includes(fileCoreNameSimple) || fileCoreNameSimple.includes(jsonCoreNameSimple))
                        ) {
                            this.pairs.push({ fromJsonArray: obj1, fromFilesArray: obj2 });
                            usedJsonTitles.add(title1);
                            usedFileTitles.add(title2);
                            foundMatchForJson = true;
                            break; // JSON spárovaný, prejsť na ďalší JSON
                        }
                    }
                }
                if (!foundMatchForJson) {
                    console.warn(`WARNING: JSON "${title1}" could not be paired.`);
                }

                this.filteredPairs = [...this.pairs];
            }

            // --- Výpisy výsledkov ---
            if (this.pairs.length === this.files.length && this.pairs.length === this.jsonFiles.length) {
                console.log("Všetky súbory a JSON súbory majú páry.");
            } else if (this.pairs.length === 0) {
                console.warn("Nenašli sa žiadne páry.");
            } else {
                const pairedJsonFullTitles = new Set(this.pairs.map((p) => p.fromJsonArray.name)); // Používame .name, nie .content.title
                const unpairedJsonFiles = this.jsonFiles.filter((json) => !pairedJsonFullTitles.has(json.name));

                const pairedFileFullPathsList = new Set(this.pairs.map((p) => p.fromFilesArray.name)); // Používame .name
                const unpairedFiles = this.files.filter((file) => !pairedFileFullPathsList.has(file.name));

                console.warn("Niektoré súbory alebo JSON súbory nemajú páry.");
                if (unpairedJsonFiles.length > 0) {
                    console.warn(
                        "Nepárové JSON súbory:",
                        unpairedJsonFiles.map((j) => j.name)
                    );
                }
                if (unpairedFiles.length > 0) {
                    console.warn(
                        "Nepárové súbory:",
                        unpairedFiles.map((f) => f.name)
                    );
                }
            }
            this.loadingPairs = false;
        },

        async setDates() {
            console.log("Nastavenie dátumov pre páry:", this.pairs);
            this.loadingSetDates = true;

            await window.electronAPI.createFolderForResults(this.folder);
            for (const pair of this.pairs) {
                this.updatingFileIndex++;

                const jsonFile = pair.fromJsonArray;
                const imageFile = pair.fromFilesArray;

                if (!jsonFile.content?.photoTakenTime?.timestamp || !jsonFile.content?.photoTakenTime?.formatted) {
                    console.warn(`JSON súbor ${jsonFile.name} neobsahuje platný timestamp.`);
                    pair.result = false;
                    continue;
                }
                console.log(
                    `Nastavujem dátumy pre súbor ${imageFile.name} z JSON súboru ${jsonFile.name} s timestamp: ${jsonFile.content.photoTakenTime.timestamp}`
                );

                const result = await window.electronAPI.setFileDates(
                    this.folder,
                    imageFile.fullPath,
                    JSON.stringify(jsonFile.content)
                );
                pair.result = result;
            }

            this.loadingSetDates = false;
            this.finished = true;
        },

        searchInPairs(event) {
            const searchValue = event.target.value;
            // console.log("searchPairs()", searchValue);
            this.filteredPairs = this.pairs.filter(pair => {
                return pair.fromJsonArray.name.includes(searchValue) || pair.fromFilesArray.name.includes(searchValue);
            });
        },
    },
};
</script>

<template>
    <div class="container my-4">
        <!-- Loading -->
        <div v-if="loadingAllFiles || loadingPairs || loadingSetDates" class="d-flex align-items-center mb-4">
            <strong v-if="loadingAllFiles" role="status">
                Prebieha načítavanie a získavanie EXIF metadát a JSON súborov...
            </strong>
            <strong v-if="loadingPairs" role="status"> Prebieha párovanie (JSON s metadátami + fotka/video)... </strong>
            <strong v-if="loadingSetDates" role="status">
                Prebieha úprava fotiek/videí podľa JSON metadát ({{ updatingFileIndex }} z {{ pairs.length }})...
            </strong>
            <div class="spinner-border text-primary ms-auto" aria-hidden="true"></div>
        </div>

        <!-- Alerts -->
        <template v-if="folder && !loadingAllFiles && !loadingPairs && !loadingSetDates && !finished">
            <div
                v-if="pairs.length === jsonFiles.length && pairs.length === files.length"
                class="alert alert-success d-flex align-items-center justify-content-between"
                role="alert"
            >
                <p class="mb-0">
                    <strong>Všetky JSON súbory s metadátami boli úspešne priradené k fotkám/videám.</strong><br />
                    Skontrolujte si výsledok párovania a potom môžete pokračovať k úprave dátumov.
                </p>
                <button class="btn btn-success ml-auto mx-2" @click="setDates">Spustiť úpravu dátumov</button>
            </div>
            <div v-else class="alert alert-error" role="alert">
                <strong>Nepodarilo sa spárovať všetky JSON súbory s fotkami/videami.</strong>
            </div>
        </template>
        <template v-if="finished">
            <div v-if="errorResults.length" class="alert alert-primary" role="alert">
                <strong>Niektoré fotky/videá sa nepodarilo spracovať:</strong>
                <ul>
                    <li v-for="error in errorResults" :key="error.fromFilesArray.name">
                        {{ error.fromFilesArray.name }} » {{ error.fromJsonArray.name }}
                    </li>
                </ul>
            </div>
            <div
                v-else-if="successResults.length === pairs.length"
                class="alert alert-success d-flex align-items-center justify-content-between"
                role="alert"
            >
                <p class="mb-0"><strong>Všetky fotky/videá boli úspešne spracované.</strong></p>
                <button class="btn btn-success mx-2" @click="reset">Späť na výber priečinka</button>
            </div>
        </template>

        <!-- Buttons -->
        <div class="mb-4">
            <button v-if="showOpenFolderBtn" class="btn btn-primary mx-2" @click="openFolder">
                Začať výberom priečinka s fotkami/videami a JSON súbormi s metadátami
            </button>
        </div>

        <div v-if="folder">
            <h3>Priečinok: {{ folder }}</h3>
            <hr />

            <template v-if="showSetDatesContent">
                <input
                    type="text"
                    class="form-control mb-3"
                    placeholder="Vyhľadávanie"
                    aria-label="Vyhľadávanie"
                    @input="searchInPairs"
                />

                <div class="table-wrapper">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th scope="col">Stav</th>
                                <th scope="col">Json s metadátami</th>
                                <th scope="col">Fotka/video</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="f in filteredPairs" :key="f">
                                <th scope="row">
                                    <small v-if="!loadingSetDates && f.result === undefined"> - </small>
                                    <small v-else-if="loadingSetDates && f.result === undefined" class="text-primary">
                                        Updating...
                                    </small>
                                    <small v-else :class="f.result ? 'text-success' : 'text-danger'">
                                        {{ f.result ? "Success" : "Error" }}
                                    </small>
                                </th>
                                <td>{{ f.fromJsonArray.name }}</td>
                                <td>{{ f.fromFilesArray.name }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped lang="scss">
.table-wrapper {
    overflow-y: auto;
    height: 70vh;

    thead th {
        background-color: #ccc;
        position: sticky;
        top: 0;
    }
}
</style>
