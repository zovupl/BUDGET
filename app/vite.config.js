import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base = имя репозитория на GitHub → сайт живёт по адресу https://zovupl.github.io/BUDGET/
export default defineConfig({
  base: "/BUDGET/",
  plugins: [react()],
});
