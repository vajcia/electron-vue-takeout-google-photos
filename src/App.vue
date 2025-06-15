<template>
    <div class="container my-4">
        <button v-if="showResetBtn" class="btn btn-danger mx-2" @click="reset">Reset</button>
        <button v-if="showOpenFolderBtn" class="btn btn-primary mx-2" @click="openFolder">Otvoriť priečinok</button>
        <button v-if="showFindPairsBtn" class="btn btn-primary mx-2" @click="findPairs">Nájsť páry</button>
        <button v-if="showSetDatesBtn" class="btn btn-primary mx-2" @click="setDates">Spustiť úpravu dátumov</button>

        <hr />

        <div v-if="showOpenFolderBtn" class="alert alert-primary" role="alert">
            Prosím, vyberte priečinok, ktorý obsahuje vaše súbory a JSON súbory.
        </div>

        <div v-if="folder">
            <h3>Priečinok: {{ folder }}</h3>
            <hr />

            <div v-if="loadingAllFiles" class="d-flex align-items-center mb-4">
                <strong role="status">Načítavanie súborov z priečinka...</strong>
                <div class="spinner-border text-primary ms-auto" aria-hidden="true"></div>
            </div>
            <div v-else-if="showFindPairsBtn" class="row">
                <div class="col-md-6">
                    <h4>Načítané JSON súbory</h4>
                    <ul>
                        <li v-for="f in jsonFiles" :key="f">
                            <b @click="f.showContent = !f.showContent">
                                {{ f.name }}
                            </b>
                            <pre v-if="f.showContent">
                        {{ f.content }}
                    </pre
                            >
                        </li>
                    </ul>
                </div>
                <div class="col-md-6">
                    <h4>Načítané obrázky a videá</h4>
                    <ul>
                        <li v-for="f in files" :key="f">
                            <b @click="f.showExif = !f.showExif">
                                {{ f.name }}
                            </b>
                            <pre v-if="f.showExif">
                        {{ f.exif }}
                    </pre
                            >
                        </li>
                    </ul>
                </div>
            </div>

            <div v-if="loadingSetDates" class="d-flex align-items-center mb-4">
                <strong role="status">Nastavovanie dátumov...</strong>
                <div class="spinner-border text-primary ms-auto" aria-hidden="true"></div>
            </div>
            <div v-if="showSetDatesContent">
                <h4 v-if="!finished">Nájdené páry</h4>
                <h4 v-else>Výsledky úpravy dátumov</h4>
                <template v-if="!loadingSetDates && !finished">
                    <div
                        v-if="pairs.length === jsonFiles.length && pairs.length === files.length"
                        class="alert alert-primary"
                        role="alert"
                    >
                        Všetky súbory a JSON súbory majú páry.
                    </div>
                    <div v-else class="alert alert-warning" role="alert">Nie všetky súbory a JSON súbory majú páry.</div>
                </template>
                <template v-if="finished">
                    <div v-if="errorResults.length" class="alert alert-primary" role="alert">
                        Niektoré páry mali chyby pri spracovaní:
                        <ul>
                            <li v-for="error in errorResults" :key="error.fromFilesArray.name">
                                {{ error.fromFilesArray.name }} -> {{ error.fromJsonArray.name }}
                            </li>
                        </ul>
                    </div>
                    <div v-else-if="successResults.length === pairs.length" class="alert alert-success" role="alert">
                        Všetky páry boli úspešne spracované.
                    </div>
                </template>
                <ul>
                    <li v-for="f in pairs" :key="f">
                        <b :class="f.result === undefined ? '' : f.result ? 'text-success' : 'text-danger'">
                            {{ f.fromFilesArray.name }} -> {{ f.fromJsonArray.name }}
                        </b>
                        <template v-if="loadingSetDates || finished">
                            <p v-if="f.result !== undefined">
                                {{ f.result ? "Dáta boli úspešne upravené." : "Nastala chyba pri úprave dát." }}
                            </p>
                            <div v-else class="d-flex align-items-center">
                                <span role="status">Prebieha úprava dátumov...</span>
                                <div class="spinner-border text-primary ms-auto" aria-hidden="true"></div>
                            </div>
                        </template>
                    </li>
                </ul>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            folder: "",
            allFiles: [],
            jsonFiles: [],
            files: [],
            pairs: [],
            loadingAllFiles: false,
            loadingPairs: false,
            loadingSetDates: false,
            finished: false,
        };
    },

    computed: {
        showResetBtn() {
            return !this.loadingAllFiles && !this.loadingPairs && !this.loadingSetDates && this.folder !== "";
        },
        showOpenFolderBtn() {
            return !this.loadingAllFiles && !this.loadingPairs && this.folder === "";
        },
        showFindPairsBtn() {
            return (
                !this.loadingAllFiles &&
                !this.loadingPairs &&
                this.allFiles.length > 0 &&
                this.jsonFiles.length > 0 &&
                this.files.length > 0 &&
                this.pairs.length === 0
            );
        },
        showSetDatesBtn() {
            return (
                !this.loadingAllFiles &&
                !this.loadingPairs &&
                !this.loadingSetDates &&
                !this.finished &&
                this.pairs.length > 0 &&
                this.pairs.length === this.jsonFiles.length &&
                this.pairs.length === this.files.length
            );
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
            this.loadingAllFiles = false;
            this.loadingPairs = false;
            this.loadingSetDates = false;
            this.finished = false;
            console.log("Aplikácia bola resetovaná.");
        },

        async openFolder() {
            const folder = await window.electronAPI.selectFolder();
            if (!folder) return;

            this.loadingAllFiles = true;

            this.folder = folder;
            console.log("Načítavam súbory z priečinka:", this.folder);
            this.allFiles = await window.electronAPI.getFiles(folder);
            console.log("Načítané súbory:", this.allFiles);

            // get json files without "metadáta.json"
            console.log("Načítavam JSON súbory...");
            this.jsonFiles = this.allFiles.filter((f) => f.name.endsWith(".json") && f.name !== "metadáta.json");
            for (const f of this.jsonFiles) {
                await window.electronAPI
                    .readJsonFile(f.fullPath)
                    .then((data) => {
                        // set json file content
                        f.content = data;
                        f.showContent = false;
                        f.fileName = this.truncateTo46(f.content.title);
                    })
                    .catch((err) => console.error(err));
            }
            console.log("Načítané JSON súbory:", this.jsonFiles);

            // get images, videos
            console.log("Načítavam obrázky a videá...");
            this.files = this.allFiles.filter(
                (f) => !f.name.endsWith(".json") && f.name !== "working" && f.name !== "success" && f.name !== "error"
            );
            for (const f of this.files) {
                await window.electronAPI
                    .getExifData(f.fullPath)
                    .then((data) => {
                        // set exif data
                        f.exif = data;
                        f.showExif = false;
                    })
                    .catch((err) => console.error(err));
            }
            console.log("Načítané obrázky a videá:", this.files);

            this.loadingAllFiles = false;
        },

        truncateTo46(str) {
            if (!str) return "";
            return str.length > 46 ? str.slice(0, 46) : str;
        },

        removeExtension(filename) {
            const lastDotIndex = filename.lastIndexOf(".");
            if (lastDotIndex === -1) return filename; // ak nemá príponu, vrátime pôvodný string
            return filename.slice(0, lastDotIndex);
        },

        findPairs() {
            this.loadingPairs = true;
            this.pairs = [];

            // Rýchle zoradenie (voliteľné, ale môže pomôcť v debugovaní alebo ak spracovanie závisí od poradia)
            this.jsonFiles.sort((a, b) => (a.content.title || "").localeCompare(b.content.title || ""));
            this.files.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            // Množina názvov, ktoré už boli spárované
            const usedJsonTitles = new Set();

            for (const obj1 of this.jsonFiles) {
                const title1 = obj1.content?.title;
                if (!title1 || usedJsonTitles.has(title1)) continue;

                const baseTitle = this.removeExtension(title1);

                for (const obj2 of this.files) {
                    const baseName = this.removeExtension(obj2.name || "");

                    if (baseTitle.includes(baseName)) {
                        this.pairs.push({ fromJsonArray: obj1, fromFilesArray: obj2 });
                        usedJsonTitles.add(title1);
                        break; // Preskoč ďalšie iterácie – už sme tento JSON spárovali
                    }
                }
            }

            if (this.pairs.length === this.files.length && this.pairs.length === this.jsonFiles.length) {
                console.log("Všetky súbory a JSON súbory majú páry.");
                this.loadingPairs = false;
            } else if (this.pairs.length > this.files.length || this.pairs.length > this.jsonFiles.length) {
                console.warn("Nájdené páry presahujú počet súborov alebo JSON súborov.");
            } else if (this.pairs.length === 0) {
                console.warn("Nenašli sa žiadne páry.");
            } else {
                console.warn("Niektoré súbory alebo JSON súbory nemajú páry.");
            }
        },

        async setDates() {
            console.log("Nastavenie dátumov pre páry:", this.pairs);
            this.loadingSetDates = true;

            await window.electronAPI.createFolderForResults(this.folder);
            for (const pair of this.pairs) {
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

                const result = await window.electronAPI.setFileDates(this.folder, imageFile.fullPath, JSON.stringify(jsonFile.content));
                pair.result = result;
            }

            this.loadingSetDates = false;
            this.finished = true;
        },
    },
};
</script>
