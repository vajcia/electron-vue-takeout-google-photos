import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    root: "src",
    build: { outDir: "../dist" },
    plugins: [vue()],
});
