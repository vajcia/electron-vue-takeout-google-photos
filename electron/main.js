const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const log = require("electron-log");
const { ExifTool } = require("exiftool-vendored");

const exiftool = new ExifTool({ taskTimeoutMillis: 300000 });

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    win.loadURL("http://localhost:5173"); // DEVELOPMENT
    // win.loadFile(path.join(__dirname, "../dist/index.html")); // PRODUCTION

    win.maximize();
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("before-quit", () => {
    log.info("Electron app is about to quit. Ending ExifTool process...");
    exiftool.end();
    log.info("ExifTool process terminated.");
});

ipcMain.handle("dialog:selectFolder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return canceled ? null : filePaths[0];
});

ipcMain.handle("get-files", async (event, folder) => {
    const files = await fs.readdir(folder);
    if (!files) return [];
    let newFiles = [];
    files.forEach((file, index) => {
        newFiles.push({ name: file, fullPath: path.join(folder, file) });
    });
    log.info(newFiles);
    return newFiles;
});

ipcMain.handle("read-file", async (event, path) => {
    return fs.readFile(path, "utf-8");
});

ipcMain.handle("read-json-file", async (event, path) => {
    try {
        const data = await fs.readFile(path, "utf-8");
        return JSON.parse(data);
    } catch (e) {
        log.error("Error reading JSON:", e);
        return null;
    }
});

ipcMain.handle("get-exif", async (event, filePath) => {
    try {
        const tags = await exiftool.read(filePath);
        return tags;
    } catch (e) {
        log.error("Error reading EXIF:", e);
        return null;
    }
});

ipcMain.handle("create-folder-for-results", (event, folderPath) => {
    const workingFolder = path.join(folderPath, "working");
    if (!fs.existsSync(workingFolder)) fs.mkdirSync(workingFolder);

    const resultsFolder = path.join(folderPath, "success");
    if (!fs.existsSync(resultsFolder)) fs.mkdirSync(resultsFolder);

    const errorFolder = path.join(folderPath, "error");
    if (!fs.existsSync(errorFolder)) fs.mkdirSync(errorFolder);
});

ipcMain.handle("set-file-dates", async (event, folderPath, filePath, jsonStr) => {
    const json = JSON.parse(jsonStr);

    const workingFolder = path.join(folderPath, "working");
    if (!fs.existsSync(workingFolder)) fs.mkdirSync(workingFolder);
    const workingPath = path.join(workingFolder, path.basename(filePath));

    const resultsFolder = path.join(folderPath, "success");
    if (!fs.existsSync(resultsFolder)) fs.mkdirSync(resultsFolder);
    const successPath = path.join(resultsFolder, path.basename(filePath));

    const errorFolder = path.join(folderPath, "error");
    if (!fs.existsSync(errorFolder)) fs.mkdirSync(errorFolder);
    const errorPath = path.join(errorFolder, path.basename(filePath));

    try {
        await fs.copy(filePath, workingPath);

        const numericPhotoTakenTime = Number(json.photoTakenTime.timestamp);
        if (isNaN(numericPhotoTakenTime) || numericPhotoTakenTime === 0) {
            throw new Error("photoTakenTime is null, undefined, or invalid number.");
        }

        log.info("--------------------------------------------------");
        log.info("Setting file dates for:", path.basename(filePath));
        const formattedDate = formatExifDate(numericPhotoTakenTime);
        log.info("Formatted Date for EXIF/XMP:", formattedDate);

        const checkBeforeWrite = await checkDates(formattedDate, workingPath, successPath, errorPath, true);
        if (checkBeforeWrite) {
            log.info("Dates already set correctly before writing. No need to write again.");
            return true;
        }

        let tagsToWrite = {
            "EXIF:DateTimeOriginal": formattedDate,
            "EXIF:CreateDate": formattedDate,
            "EXIF:ModifyDate": formattedDate,
            "XMP-dc:Date": formattedDate,
            "XMP-photoshop:DateCreated": formattedDate,
            "XMP-xmp:CreateDate": formattedDate,
            "XMP-xmp:ModifyDate": formattedDate,
            "IPTC:DateCreated": formattedDate,
            "IPTC:DigitalCreateDate": formattedDate,
            "QuickTime:CreateDate": formattedDate,
            "QuickTime:CreationDate": formattedDate,
            "QuickTime:ModifyDate": formattedDate,
        };

        try {
            await exiftool.write(workingPath, tagsToWrite);
        } catch (error) {
            const errorMessage = error.message?.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));

            if (errorMessage?.includes("Can't read GPS data")) {
                log.warn("ExifTool write failed due to missing GPS data. Attempting to set dates without GPS tags.");
                // TODO: fix this in the future
            } else if (errorMessage?.includes("rror reading OtherImageStart data in IFD0")) {
                log.warn("ExifTool write failed due to OtherImageStart data. Attempting to set dates without this tag.");
                // TODO: fix this in the future
            } else {
                log.error("ExifTool write failed with a critical error:", error);
            }
        }

        return await checkDates(formattedDate, workingPath, successPath, errorPath, false);
    } catch (error) {
        log.error("Error setting file dates:", error);
        if (fs.existsSync(workingPath)) {
            await fs.move(workingPath, errorPath, { overwrite: true });
        }
        return false;
    }
});

async function checkDates(formattedDate, workingPath, successPath, errorPath, beforeWrite) {
    const metadata = await exiftool.read(workingPath);

    const checkResult =
        (metadata.DateTimeOriginal && metadata.DateTimeOriginal.rawValue === formattedDate) ||
        (metadata.CreateDate && metadata.CreateDate.rawValue === formattedDate) ||
        (metadata["XMP-xmp:CreateDate"] && metadata["XMP-xmp:CreateDate"].rawValue === formattedDate) ||
        (metadata.DateCreated && metadata.DateCreated === formattedDate.substring(0, 10).replace(/:/g, ":"));

    if (checkResult) {
        if (beforeWrite) log.info("File dates already set correctly before writing.");
        else log.info("File dates successfully set to:", formattedDate);
        await fs.move(workingPath, successPath, { overwrite: true });
        return true;
    } else {
        if (!beforeWrite) {
            log.warn("File dates were not set correctly. Moving to error folder.");
            log.info("Expected date:", formattedDate);
            log.info("Actual date:", metadata.DateTimeOriginal?.rawValue || metadata.CreateDate?.rawValue || metadata["XMP-xmp:CreateDate"]?.rawValue || "N/A");
            await fs.move(workingPath, errorPath, { overwrite: true });
        }
        return false;
    }
}

function formatExifDate(timestamp) {
    const date = new Date(Number(timestamp) * 1000);
    const pad = (n) => n.toString().padStart(2, "0");

    // YYYY:MM:DD HH:MM:SS
    return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(
        date.getMinutes()
    )}:${pad(date.getSeconds())}`;
}
