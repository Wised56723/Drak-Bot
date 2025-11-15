import { ExtendedClient } from "./structs/ExtendedClient";
export * from "colors"; 
import config from "./config.json";
import { startLotteryScheduler } from "./services/LotteryScheduler";
import { Events } from "discord.js"; // NOVO: Importa Events

const client = new ExtendedClient();
client.start();
export { client, config };

// MODIFICADO: "ready" -> Events.ClientReady
client.once(Events.ClientReady, () => {
    console.log("Bot is online!".green);
    
    startLotteryScheduler(client);
});