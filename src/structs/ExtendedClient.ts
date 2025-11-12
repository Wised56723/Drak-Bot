import { Client, Partials, IntentsBitField, BitFieldResolvable, GatewayIntentsString, Component, Collection } from "discord.js";

import dotenv from "dotenv";
import { CommandType, ComponentsButton } from "./types/Command";
dotenv.config();

export class ExtendedClient extends Client{

    public commands: Collection<String, CommandType> = new Collection();
    public buttons: ComponentsButton = new Collection();
    public selects: Collection<String, (interaction: Component) => any> = new Collection();
    public modals: Collection<String, (interaction: Component) => any> = new Collection();

    constructor(){
        super({
            intents: Object.keys(IntentsBitField.Flags) as BitFieldResolvable<GatewayIntentsString, number>,
            partials: [
                Partials.Message,
                Partials.Channel,
                Partials.Reaction,
                Partials.GuildMember,
                Partials.GuildScheduledEvent,
                Partials.User,
                Partials.ThreadMember
            ] 
        });
    }

    public start(){
        this.login(process.env.BOT_TOKEN);
    }
}