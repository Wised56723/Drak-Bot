// src/structs/ExtendedClient.ts

import { 
    Client, Partials, IntentsBitField, BitFieldResolvable, 
    GatewayIntentsString, Collection, Interaction, REST, Routes, 
    ApplicationCommandData,
    Events,
    ChatInputCommandInteraction
} from "discord.js";
import { config } from "dotenv";
import { CommandType, ComponentsButton, ComponentsModal, ComponentsSelect } from "./types/Command";
import { glob } from "glob";
import { join } from "path";
import { Logger } from "../utils/Logger";

config(); // Carrega o .env

export class ExtendedClient extends Client {

    public commands: Collection<string, CommandType> = new Collection();
    public buttons: ComponentsButton = new Collection();
    public selects: ComponentsSelect = new Collection();
    public modals: ComponentsModal = new Collection();

    constructor() {
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

    private async registerCommands() {
        (BigInt.prototype as any).toJSON = function() { return this.toString(); };

        const commands: ApplicationCommandData[] = [];
        const commandFiles = await glob(join(__dirname, "..", "commands", "**", "*.{ts,js}"));

        Logger.info("Cliente", `Carregando ${commandFiles.length} comandos...`);

        for (const file of commandFiles) {
            try {
                const commandModule = await import(file);
                const command: CommandType = commandModule.default;

                if (!command) continue;

                this.commands.set(command.name, command);
                commands.push(command);

                if (command.buttons) {
                    command.buttons.forEach((run, key) => this.buttons.set(key, run));
                }
                
                if (command.modals) {
                    command.modals.forEach((run, key) => this.modals.set(key, run));
                }
                
                if (command.selects) {
                    command.selects.forEach((run, key) => this.selects.set(key, run));
                }
                
            } catch (error) {
                Logger.error("Cliente", `Falha ao carregar o comando em ${file}`, error);
            }
        }

        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN!);
        try {
            Logger.info("Cliente", `Registrando ${commands.length} slash commands...`);
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID!), 
                { body: commands }
            );
            Logger.info("Cliente", "Slash commands registrados com sucesso!");
        } catch (error) {
            Logger.error("Cliente", "Falha ao registrar comandos na API do Discord", error);
        }
    }

    private registerListeners() {
        
        this.on(Events.InteractionCreate, async (interaction: Interaction) => {
            
            // --- HANDLER DE COMANDO ATUALIZADO ---
            if (interaction.isChatInputCommand()) { 
                const command = this.commands.get(interaction.commandName);
                if (!command) {
                    Logger.warn("Cliente", `Comando de chat não encontrado: ${interaction.commandName}`);
                    return;
                }

                // --- CORREÇÃO DE SEGURANÇA CENTRALIZADA ---
                // Verifica se o comando NÃO tem permissão em DMs (dmPermission: false ou undefined)
                // E se a interação está a ocorrer numa DM (!interaction.inGuild())
                if (command.dmPermission === false && !interaction.inGuild()) {
                    Logger.warn("Cliente", `Comando de admin ${command.name} bloqueado em DM para ${interaction.user.id}.`);
                    return interaction.reply({
                        content: "Este comando não pode ser usado em mensagens diretas.",
                        ephemeral: true
                    });
                }
                // --- FIM DA CORREÇÃO DE SEGURANÇA ---
                
                try {
                    await command.run({
                        client: this,
                        interaction: interaction as ChatInputCommandInteraction,
                        options: interaction.options
                    });
                } catch (error) {
                    Logger.error("Comando", `Erro ao executar o comando: ${interaction.commandName}`, error);
                    const payload = { content: "Ocorreu um erro ao executar este comando.", ephemeral: true };
                    try {
                        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                        else await interaction.reply(payload);
                    } catch (replyError) {
                        Logger.error("Cliente", "Erro ao tentar responder a um comando falhado", replyError);
                    }
                }
                return;
            }
            // --- FIM DO HANDLER DE COMANDO ---
            
            if (interaction.isModalSubmit()) {
                try {
                    let modal = this.modals.get(interaction.customId);
                    
                    if (!modal) {
                        const modalKey = Array.from(this.modals.keys()).find(key => interaction.customId.startsWith(key));
                        if (modalKey) {
                            modal = this.modals.get(modalKey);
                        }
                    }
                    
                    if (modal) {
                        await modal(interaction, this); 
                    } else {
                        Logger.warn("Modal", `Handler de modal não encontrado para o ID: ${interaction.customId}`);
                        if (interaction.isRepliable()) {
                             await interaction.reply({ content: "Este formulário não foi encontrado. Pode ser uma mensagem antiga.", ephemeral: true });
                        }
                    }
                } catch (error: any) {
                    Logger.error("Modal", `Erro ao processar modal: ${interaction.customId}`, error);
                    if (interaction.isRepliable()) {
                        const payload = { content: "Ocorreu um erro ao submeter este formulário.", ephemeral: true };
                        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                        else await interaction.reply(payload);
                    }
                }
                return;
            }
            
            if (interaction.isButton()) {
                try {
                    let button = this.buttons.get(interaction.customId);
                    if (!button) {
                        const buttonKey = Array.from(this.buttons.keys()).find(key => interaction.customId.startsWith(key));
                        if (buttonKey) {
                            button = this.buttons.get(buttonKey);
                        }
                    }

                    if (button) {
                        await button(interaction, this);
                    } else {
                        Logger.warn("Botao", `Handler de botão não encontrado para o ID: ${interaction.customId}`);
                        if (interaction.isRepliable()) {
                             await interaction.reply({ content: "Este botão não foi encontrado. Pode ser uma mensagem antiga.", ephemeral: true });
                        }
                    }
                } catch (error: any) {
                    Logger.error("Botao", `Erro ao processar botão: ${interaction.customId}`, error);
                    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: "Ocorreu um erro ao processar este botão.", ephemeral: true });
                    }
                }
                return;
            }
            
            if (interaction.isStringSelectMenu()) {
                try {
                    let select = this.selects.get(interaction.customId);
                    if (!select) {
                        const selectKey = Array.from(this.selects.keys()).find(key => interaction.customId.startsWith(key));
                        if (selectKey) {
                            select = this.selects.get(selectKey);
                        }
                    }

                    if (select) {
                        await select(interaction, this);
                    } else {
                        Logger.warn("Cliente", `Handler de select menu não encontrado para o ID: ${interaction.customId}`);
                        if (interaction.isRepliable()) {
                            await interaction.reply({ content: "Este menu não foi encontrado.", ephemeral: true });
                        }
                    }
                } catch (error: any) {
                    Logger.error("Cliente", `Erro ao processar select menu: ${interaction.customId}`, error);
                    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: "Ocorreu um erro ao processar este menu.", ephemeral: true });
                    }
                }
                return;
            }
        });

        this.on(Events.Error, (error) => {
            Logger.error("Cliente", "ERRO GERAL DO CLIENTE (Events.Error)", error);
        });
    }
    
    public async start() {
        await this.registerCommands();
        this.registerListeners();      
        
        Logger.info("Cliente", "Logando no Discord...");
        this.login(process.env.BOT_TOKEN);
    }
}