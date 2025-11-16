// src/index.ts

import { ExtendedClient } from "./structs/ExtendedClient";
export * from "colors"; 
import config from "./config.json";
import { startLotteryScheduler } from "./services/LotteryScheduler";
import { Events } from "discord.js";
import { Logger } from "./utils/Logger"; // Importa o Logger

const client = new ExtendedClient();
client.start();
export { client, config };

client.once(Events.ClientReady, () => {
    // Antes:
    // console.log("Bot is online!".green);
    
    // Agora:
    Logger.info("Cliente", "Bot está online e pronto!");
    
    startLotteryScheduler(client);
});