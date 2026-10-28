declare module "dynalite" {
  import type { Server } from "http";
  interface DynaliteOptions {
    createTableMs?: number;
    deleteTableMs?: number;
    updateTableMs?: number;
  }
  function dynalite(options?: DynaliteOptions): Server;
  export default dynalite;
}
