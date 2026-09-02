import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()]
  // Phase later: add a `server.proxy` entry here (or a Vite middleware) to
  // forward /api/* to your local key-holding proxy during development, then
  // to the Cloudflare Worker in production.
});
