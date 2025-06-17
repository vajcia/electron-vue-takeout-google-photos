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
            unpairedJsonFiles: [],
            unpairedFiles: [],
            loadingAllFiles: false,
            loadingPairs: false,
            loadingSetDates: false,
            updatingFileIndex: 0,
            finished: false,
            searchInput: "",
            searchSelect: "all",
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
            this.unpairedJsonFiles = [];
            this.unpairedFiles = [];
            this.loadingAllFiles = false;
            this.loadingPairs = false;
            this.loadingSetDates = false;
            this.updatingFileIndex = 0;
            this.finished = false;
            this.searchInput = "";
            this.searchSelect = "all";
            console.log("Aplikácia bola resetovaná.");
        },

        async openFolder() {
            const folder = await window.electronAPI.selectFolder();
            if (!folder) return;

            this.loadingAllFiles = true;
            this.folder = folder;

            this.allFiles = await window.electronAPI.getFiles(folder);

            // json files
            this.jsonFiles = this.allFiles.filter((f) => f.name.endsWith(".json") && f.name !== "metadáta.json");

            const jsonPromises = this.jsonFiles.map(async (f) => {
                try {
                    const data = await window.electronAPI.readJsonFile(f.fullPath);
                    f.content = data;
                } catch (err) {
                    console.error(`Chyba pri čítaní JSON súboru ${f.name}:`, err);
                    f.content = null;
                }
            });

            await Promise.all(jsonPromises);

            // files -> images, videos
            this.files = this.allFiles.filter(
                (f) => !f.name.endsWith(".json") && f.name !== "working" && f.name !== "success" && f.name !== "error"
            );

            this.loadingAllFiles = false;

            this.findPairs();
        },

        truncateTo46(str) {
            if (!str) return "";
            return str.length > 46 ? str.substring(0, 43) + "..." : str;
        },

        removeExtension(filename) {
            const lastDotIndex = filename.lastIndexOf(".");
            if (lastDotIndex === -1) return filename;
            return filename.slice(0, lastDotIndex);
        },

        findPairs() {
            this.loadingPairs = true;
            this.pairs = [];
            this.filteredPairs = [];

            const usedJsonTitles = new Set();
            const usedFileTitles = new Set();

            const getNormalizedPairingKey = (name, isJsonOrigin = false) => {
                if (!name) return "";
                let cleaned = name.toLowerCase();

                if (isJsonOrigin) cleaned = cleaned.replace(/\.json$/, "");

                let hasParenOneBeforeSupplementalMetadata = false;
                if (cleaned.includes(".supplemental-metadata") && cleaned.endsWith("(1)"))
                    hasParenOneBeforeSupplementalMetadata = true;

                cleaned = cleaned.replace(/\.supplemental-metadata/, "");

                const mediaExtensionRegex = /\.(jpg|jpeg|png|gif|bmp|tiff|webp|mp4|mov|avi|webm|mkv|3gp|heic)$/;
                cleaned = cleaned.replace(mediaExtensionRegex, "");

                if (hasParenOneBeforeSupplementalMetadata && !cleaned.endsWith("(1)")) cleaned += "(1)";

                cleaned = cleaned.replace(/\.$/, "");

                return cleaned.trim();
            };

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
            filesByPairingKey.forEach((fileList) => {
                fileList.sort((a, b) => {
                    const aBase = this.removeExtension(a.name);
                    const bBase = this.removeExtension(b.name);
                    if (aBase.endsWith("(1)") && !bBase.endsWith("(1)")) return -1;
                    if (!aBase.endsWith("(1)") && bBase.endsWith("(1)")) return 1;
                    return aBase.localeCompare(bBase);
                });
            });

            this.jsonFiles.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

            for (const obj1 of this.jsonFiles) {
                const title1 = obj1.name;
                if (!title1 || usedJsonTitles.has(title1)) continue;

                let foundMatchForJson = false;

                const jsonPairingKey = getNormalizedPairingKey(title1, true);

                const potentialFiles = filesByPairingKey.get(jsonPairingKey) || [];

                for (const obj2 of potentialFiles) {
                    const title2 = obj2.name;
                    if (usedFileTitles.has(title2)) continue;

                    this.pairs.push({ fromJsonArray: obj1, fromFilesArray: obj2 });
                    usedJsonTitles.add(title1);
                    usedFileTitles.add(title2);
                    foundMatchForJson = true;
                    break;
                }

                if (!foundMatchForJson) {
                    const jsonCoreNameSimple = jsonPairingKey.replace(/\(\d+\)$/, "");

                    for (const obj2 of this.files) {
                        const title2 = obj2.name;
                        if (usedFileTitles.has(title2)) continue;

                        const filePairingKey = getNormalizedPairingKey(title2);
                        const fileCoreNameSimple = filePairingKey.replace(/\(\d+\)$/, "");

                        if (
                            jsonCoreNameSimple.length > 0 &&
                            fileCoreNameSimple.length > 0 &&
                            (jsonCoreNameSimple.includes(fileCoreNameSimple) || fileCoreNameSimple.includes(jsonCoreNameSimple))
                        ) {
                            this.pairs.push({ fromJsonArray: obj1, fromFilesArray: obj2 });
                            usedJsonTitles.add(title1);
                            usedFileTitles.add(title2);
                            foundMatchForJson = true;
                            break;
                        }
                    }
                }
                if (!foundMatchForJson) {
                    console.warn(`WARNING: JSON "${title1}" could not be paired.`);
                }

                this.filteredPairs = [...this.pairs];
            }

            // results
            if (this.pairs.length === this.files.length && this.pairs.length === this.jsonFiles.length) {
                console.log("All JSON files successfully paired with images/videos.");
            } else if (this.pairs.length === 0) {
                console.warn("No pairs found.");
            } else {
                const pairedJsonFullTitles = new Set(this.pairs.map((p) => p.fromJsonArray.name));
                const unpairedJsonFiles = this.jsonFiles.filter((json) => !pairedJsonFullTitles.has(json.name));

                const pairedFileFullPathsList = new Set(this.pairs.map((p) => p.fromFilesArray.name));
                const unpairedFiles = this.files.filter((file) => !pairedFileFullPathsList.has(file.name));

                console.warn("Some JSON files were not paired with any images/videos.");
                if (unpairedJsonFiles.length > 0) {
                    console.warn(
                        "Unpaired JSON files:",
                        unpairedJsonFiles.map((j) => j.name)
                    );
                }
                if (unpairedFiles.length > 0) {
                    console.warn(
                        "Unpaired files:",
                        unpairedFiles.map((f) => f.name)
                    );
                }

                this.unpairedJsonFiles = unpairedJsonFiles;
                this.unpairedFiles = unpairedFiles;
            }
            this.loadingPairs = false;
        },

        async setDates() {
            this.loadingSetDates = true;

            await window.electronAPI.createFolderForResults(this.folder);
            for (const pair of this.pairs) {
                this.updatingFileIndex++;

                const jsonFile = pair.fromJsonArray;
                const imageFile = pair.fromFilesArray;

                if (!jsonFile.content?.photoTakenTime?.timestamp || !jsonFile.content?.photoTakenTime?.formatted) {
                    console.warn(`JSON file ${jsonFile.name} does not contain valid photoTakenTime data.`);
                    pair.result = false;
                    continue;
                }
                console.log(
                    `Setting dates for file ${imageFile.name} from JSON file ${jsonFile.name} with timestamp: ${jsonFile.content.photoTakenTime.timestamp}`
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

        searchInPairs() {
            this.filteredPairs = this.pairs
                .filter((pair) => {
                    return (
                        pair.fromJsonArray.name.includes(this.searchInput) || pair.fromFilesArray.name.includes(this.searchInput)
                    );
                })
                .filter((pair) => {
                    if (this.searchSelect === "waiting") return pair.result === undefined;
                    else if (this.searchSelect === "ok") return pair.result === true;
                    else if (this.searchSelect === "nok") return pair.result === false;
                    else return true;
                });
        },
    },

    watch: {
        pairs: {
            handler() {
                console.log("Pairs updated:", this.pairs);
                this.searchInPairs();
            },
            deep: true,
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
                class="alert alert-info d-flex align-items-center justify-content-between"
                role="alert"
            >
                <p class="mb-0">
                    <strong>Všetky JSON súbory s metadátami boli úspešne priradené k fotkám/videám.</strong><br />
                    Skontrolujte si výsledok párovania a potom môžete pokračovať k úprave dátumov.
                </p>
                <button class="btn btn-info ml-auto mx-2" @click="setDates">Spustiť úpravu dátumov</button>
            </div>
            <div v-else class="alert alert-danger" role="alert">
                <p><strong>Nepodarilo sa spárovať všetky JSON súbory s fotkami/videami.</strong></p>
                <template v-if="unpairedJsonFiles.length > 0">
                    <h6>Nespárované JSON súbory:</h6>
                    <ul>
                        <li v-for="error in unpairedJsonFiles" :key="error.fullPath">
                            {{ error.fullPath }}
                        </li>
                    </ul>
                </template>
                <template v-if="unpairedFiles.length > 0">
                    <h6>Nespárované fotky/videá:</h6>
                    <ul>
                        <li v-for="error in unpairedFiles" :key="error.fullPath">
                            {{ error.fullPath }}
                        </li>
                    </ul>
                </template>
            </div>
        </template>
        <template v-if="finished">
            <div v-if="errorResults.length" class="alert alert-warning" role="alert">
                <p><strong>Niektoré fotky/videá sa nepodarilo spracovať:</strong></p>
                <ul>
                    <li v-for="error in errorResults" :key="error.fromFilesArray.fullPath">
                        {{ error.fromFilesArray.fullPath }}
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
        <div class="my-4">
            <button v-if="showOpenFolderBtn" class="btn btn-primary mx-2" @click="openFolder">
                Začať výberom priečinka s fotkami/videami a JSON súbormi s metadátami
            </button>

            <button
                v-if="
                    (finished && errorResults.length) ||
                    (folder &&
                        !loadingAllFiles &&
                        !loadingPairs &&
                        !loadingSetDates &&
                        !finished &&
                        (pairs.length != jsonFiles.length || pairs.length !== files.length))
                "
                class="btn btn-secondary mx-2"
                @click="reset"
            >
                Späť na začiatok
            </button>
        </div>

        <div v-if="folder">
            <h3>Priečinok: {{ folder }}</h3>
            <hr />

            <template v-if="showSetDatesContent">
                <div class="row mb-3">
                    <div class="col-md-6">
                        <input
                            v-model="searchInput"
                            type="text"
                            class="form-control"
                            placeholder="Vyhľadávanie"
                            aria-label="Vyhľadávanie"
                            @input="searchInPairs"
                        />
                    </div>
                    <div class="col-md-2">
                        <select v-model="searchSelect" class="form-select" aria-label="Search options" @change="searchInPairs">
                            <option value="all">Všetky</option>
                            <option value="waiting">Čakajúce</option>
                            <option value="ok">Úspešné</option>
                            <option value="nok">Neúspešné</option>
                        </select>
                    </div>
                </div>

                <div class="table-wrapper">
                    <table class="table">
                        <thead>
                            <tr>
                                <th scope="col" class="bg-primary text-white">Stav</th>
                                <th scope="col" class="bg-primary text-white">Json s metadátami</th>
                                <th scope="col" class="bg-primary text-white">Fotka/video</th>
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
        position: sticky;
        top: 0;
    }
}
</style>
