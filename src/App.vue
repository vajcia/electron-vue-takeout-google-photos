<template>
    <div style="padding: 20px">
        <button v-if="showResetBtn" @click="reset">Reset</button>
        <button v-if="showOpenFolderBtn" @click="openFolder">Otvoriť priečinok</button>
        <button v-if="showFindPairsBtn" @click="findPairs">Nájsť páry</button>
        <button v-if="showSetDatesBtn" @click="setDates">Nastaviť dátumy</button>

        <div v-if="folder">
            <h3>Priečinok: {{ folder }}</h3>
            <p v-if="loadingAllFiles">Načítavanie súborov...</p>
            <div v-else-if="showFindPairsBtn">
                <h4>Načítané JSON súbory ({{ jsonFiles.length }})</h4>
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

                <h4>Načítané obrázky a videá ({{ files.length }})</h4>
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

            <div v-if="showSetDatesBtn">
                <h4>Nájdené páry</h4>
                <ul>
                    <li v-for="f in pairs" :key="f">
                        <b> {{ f.fromFilesArray.name }} -> {{ f.fromJsonArray.name }} </b>
                        <p v-if="f.result !== undefined">{{ f.result ? "SUCCESS" : "ERROR" }}</p>
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
        };
    },

    computed: {
        showResetBtn() {
            return !this.loadingAllFiles && !this.loadingPairs && this.folder !== "";
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
            return !this.loadingAllFiles && !this.loadingPairs && this.pairs.length > 0;
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
        },

        async openFolder() {
            const folder = await window.electronAPI.selectFolder();
            if (!folder) return;

            this.loadingAllFiles = true;

            this.folder = folder;
            this.allFiles = await window.electronAPI.getFiles(folder);
            console.log("Načítané súbory:", this.allFiles);

            // get json files without "metadáta.json"
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

            // get images, videos
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
            await window.electronAPI.createFolderForResults(this.folder);
            for (const pair of this.pairs) {
                const jsonFile = pair.fromJsonArray;
                const imageFile = pair.fromFilesArray;

                if (!jsonFile.content?.photoTakenTime?.timestamp || !jsonFile.content?.photoTakenTime?.formatted) {
                    console.warn(`JSON súbor ${jsonFile.name} neobsahuje platný timestamp.`);
                    pair.result = false;
                    continue;
                }

                const photoTakenTimeTimestamp = jsonFile.content.photoTakenTime.timestamp;
                const photoTakenTimeFormatted = jsonFile.content.photoTakenTime.formatted;
                console.log(`Nastavujem dátum pre ${imageFile.name} na ${photoTakenTimeFormatted} (${photoTakenTimeTimestamp})`);

                const result = await window.electronAPI.setFileDates(this.folder, imageFile.fullPath, photoTakenTimeTimestamp);
                pair.result = result;
            }
        },
    },
};
</script>
