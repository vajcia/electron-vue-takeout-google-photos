const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const { execFile } = require("child_process");

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
    win.loadFile(path.join(__dirname, "../src/index.html"));
}

app.whenReady().then(createWindow);

ipcMain.handle("dialog:selectFolder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return canceled ? null : filePaths[0];
});

ipcMain.handle("get-files", async (event, folder) => {
    const files = await fs.readdir(folder);
    return files.filter((f) => /\.(jpe?g|png|json)$/i.test(f));
});

ipcMain.handle("run-exiftool", (event, filePath, dateTime) => {
    return new Promise((resolve, reject) => {
        execFile("exiftool", [`-overwrite_original`, `-DateTimeOriginal=${dateTime}`, filePath], (err) => {
            err ? reject(err) : resolve(true);
        });
    });
});
