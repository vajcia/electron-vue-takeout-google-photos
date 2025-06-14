const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
    getFiles: (path) => ipcRenderer.invoke("get-files", path),
    runExif: (file, dateTime) => ipcRenderer.invoke("run-exiftool", file, dateTime),
});
