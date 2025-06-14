const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    selectFolder: () => ipcRenderer.invoke("dialog:selectFolder"),
    getFiles: (folderPath) => ipcRenderer.invoke("get-files", folderPath),
    readJsonFile: (filePath) => ipcRenderer.invoke("read-json-file", filePath),
    getExifData: (filePath) => ipcRenderer.invoke("get-exif", filePath),
    createFolderForResults: (folderPath) => ipcRenderer.invoke("create-folder-for-results", folderPath),
    setFileDates: (folderPath, filePath, photoTakenTime) =>
        ipcRenderer.invoke("set-file-dates", folderPath, filePath, photoTakenTime),
});
