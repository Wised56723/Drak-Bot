// src/index.ts

import { ExtendedClient } from "./structs/ExtendedClient";
export * from "colors"; 
// --- REMOVIDO: import config from "./config.json"; ---
import { startLotteryScheduler } from "./services/LotteryScheduler";
import { Events } from "discord.js";
import { Logger } from "./utils/Logger";

const client = new ExtendedClient();
client.start();
// --- REMOVIDO: export { client, config }; ---
export { client }; // Apenas exportamos o client

client.once(Events.ClientReady, () => {
    Logger.info("Cliente", "Bot está online e pronto!");
    
    startLotteryScheduler(client);
});