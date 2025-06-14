const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const { execFile } = require("child_process");
const { exiftool } = require("exiftool-vendored");

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
    console.log("Electron app is about to quit. Ending ExifTool process...");
    exiftool.end();
    console.log("ExifTool process terminated.");
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
    console.log(newFiles);
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
        console.error("Error reading JSON:", e);
        return null;
    }
});

ipcMain.handle("get-exif", async (event, filePath) => {
    try {
        const tags = await exiftool.read(filePath);
        return tags;
    } catch (e) {
        console.error("Error reading EXIF:", e);
        return null;
    }
});

ipcMain.handle("run-exiftool", (event, filePath, dateTime) => {
    return new Promise((resolve, reject) => {
        execFile("exiftool", [`-overwrite_original`, `-DateTimeOriginal=${dateTime}`, filePath], (err) => {
            err ? reject(err) : resolve(true);
        });
    });
});

ipcMain.handle("create-folder-for-results", (event, folderPath) => {
    const workingFolder = path.join(folderPath, "working");
    if (!fs.existsSync(workingFolder)) fs.mkdirSync(workingFolder);

    const resultsFolder = path.join(folderPath, "success");
    if (!fs.existsSync(resultsFolder)) fs.mkdirSync(resultsFolder);

    const errorFolder = path.join(folderPath, "error");
    if (!fs.existsSync(errorFolder)) fs.mkdirSync(errorFolder);
});

ipcMain.handle("set-file-dates", async (event, folderPath, filePath, photoTakenTime) => {
    const workingFolder = path.join(folderPath, "working");
    if (!fs.existsSync(workingFolder)) fs.mkdirSync(workingFolder);
    const workingPath = path.join(workingFolder, path.basename(filePath));

    const resultsFolder = path.join(folderPath, "success");
    if (!fs.existsSync(resultsFolder)) fs.mkdirSync(resultsFolder);
    const successPath = path.join(resultsFolder, path.basename(filePath));

    const errorFolder = path.join(folderPath, "error");
    if (!fs.existsSync(errorFolder)) fs.mkdirSync(errorPath);
    const errorPath = path.join(errorFolder, path.basename(filePath));

    try {
        await fs.copy(filePath, workingPath);

        const numericPhotoTakenTime = Number(photoTakenTime);
        if (isNaN(numericPhotoTakenTime) || numericPhotoTakenTime === 0) {
            throw new Error("photoTakenTime is null, undefined, or invalid number.");
        }

        console.log("\n----------\n");
        const formattedDate = formatExifDate(numericPhotoTakenTime);

        console.log("Formatted Date for EXIF/XMP:", formattedDate);
        console.log("ExifTool Version (from vendored):", await exiftool.version());

        const before = await exiftool.read(workingPath);
        console.log("Before write EXIF/XMP:", before);

        const tagsToWrite = {
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

        await exiftool.write(workingPath, tagsToWrite);

        const metadata = await exiftool.read(workingPath);
        console.log("Updated metadata (after write):", metadata);

        const successfullyUpdated =
            (metadata.DateTimeOriginal && metadata.DateTimeOriginal.rawValue === formattedDate) ||
            (metadata.CreateDate && metadata.CreateDate.rawValue === formattedDate) ||
            (metadata["XMP-xmp:CreateDate"] && metadata["XMP-xmp:CreateDate"].rawValue === formattedDate) ||
            (metadata.DateCreated && metadata.DateCreated === formattedDate.substring(0, 10).replace(/:/g, ":"));

        if (successfullyUpdated) {
            console.log("At least one key date field (DateTimeOriginal, CreateDate, XMP:CreateDate) successfully updated.");
            await fs.move(workingPath, successPath, { overwrite: true });
            return true;
        } else {
            console.warn(
                "No key date fields (DateTimeOriginal, CreateDate, XMP:CreateDate) were updated correctly or are displayed in metadata."
            );
            await fs.move(workingPath, errorPath, { overwrite: true });
            return false;
        }
    } catch (error) {
        console.error("Error setting file dates:", error);
        if (fs.existsSync(workingPath)) {
            await fs.move(workingPath, errorPath, { overwrite: true });
        }
        return false;
    }
});

function formatExifDate(timestamp) {
    const date = new Date(Number(timestamp) * 1000);
    const pad = (n) => n.toString().padStart(2, "0");

    // YYYY:MM:DD HH:MM:SS
    return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(
        date.getMinutes()
    )}:${pad(date.getSeconds())}`;
}
