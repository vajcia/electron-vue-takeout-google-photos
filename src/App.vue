<template>
    <div style="padding:20px">
      <button @click="openFolder">Otvoriť priečinok</button>
      <div v-if="folder">
        <h3>Priečinok: {{ folder }}</h3>
        <ul>
          <li v-for="f in files" :key="f">
            <span>{{ f }}</span>
            <button @click="fixExif(f)" :disabled="loading[f]">Opraviť EXIF</button>
          </li>
        </ul>
      </div>
    </div>
  </template>
  
  <script>
  import fs from 'fs-extra';
  export default {
    data(){ return { folder: '', files: [], loading: {} }},
    methods: {
      async openFolder(){
        const folder = await window.electronAPI.selectFolder();
        if(!folder) return;
        this.folder = folder;
        this.files = await window.electronAPI.getFiles(folder);
      },
      async fixExif(f){
        this.$set(this.loading, f, true);
        const jsonPath = `${this.folder}/${f.replace(/\.(jpe?g|png)/i,'.json')}`;
        if(!(await fs.pathExists(jsonPath))){
          alert('JSON neexistuje pre: ' + f);
          this.loading[f] = false;
          return;
        }
        const json = await fs.readJson(jsonPath);
        const ts = json.photoTakenTime?.timestamp;
        if(!ts){ alert('Žiadny timestamp v ' + jsonPath); this.loading[f]=false; return; }
        const dt = new Date(ts * 1000).toISOString().replace('T',' ').substr(0,19);
        await window.electronAPI.runExif(`${this.folder}/${f}`, dt);
        this.loading[f] = false;
        alert('EXIF opravený: ' + f);
      }
    }
  };
  </script>
  