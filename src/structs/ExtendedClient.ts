import { 
    Client, Partials, IntentsBitField, BitFieldResolvable, 
    GatewayIntentsString, Collection, Interaction, REST, Routes, 
    ApplicationCommandData,
    Events
} from "discord.js";
import dotenv from "dotenv";
import { CommandType, ComponentsButton, ComponentsModal, ComponentsSelect } from "./types/Command";
import { glob } from "glob";
import path from "path";
dotenv.config();

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
        const commandFiles = await glob(path.join(__dirname, "..", "commands", "**", "*.{ts,js}"));

        console.log(`[COMANDOS]: Carregando ${commandFiles.length} comandos...`);

        for (const file of commandFiles) {
            try {
                const commandModule = await import(file);
                const command: CommandType = commandModule.default;

                if (!command) continue;

                this.commands.set(command.name, command);
                commands.push(command);

                if (command.buttons) {
                    console.log(`[DEBUG] Carregando ${command.buttons.size} botões de: ${command.name}`);
                    command.buttons.forEach((run, key) => {
                        console.log(`[DEBUG]   -> Registando handler de botão: ${key}`);
                        this.buttons.set(key, run);
                    });
                }
                
                // --- NOVO LOG DE DEPURACAO ---
                if (command.modals) {
                    console.log(`[DEBUG] Carregando ${command.modals.size} modais de: ${command.name}`);
                    command.modals.forEach((run, key) => {
                        console.log(`[DEBUG]   -> Registando handler de modal: ${key}`);
                        this.modals.set(key, run);
                    });
                }
                // --- FIM DO LOG ---
                
                if (command.selects) {
                    command.selects.forEach((run, key) => this.selects.set(key, run));
                }
                
                console.log(`[COMANDOS]: Comando "${command.name}" carregado.`);
            } catch (error) {
                console.error(`[ERRO] Falha ao carregar o comando em ${file}:`, error);
            }
        }

        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN!);
        try {
            console.log(`[COMANDOS]: Registrando ${commands.length} slash commands...`);
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID!), 
                { body: commands }
            );
            console.log(`[COMANDOS]: Slash commands registrados com sucesso!`);
        } catch (error) {
            console.error("[ERRO API]: Falha ao registrar comandos:", error);
        }
    }

    private registerListeners() {
        
        this.on(Events.InteractionCreate, async (interaction: Interaction) => {
            
            if (interaction.isChatInputCommand()) { 
                // ... (lógica do chat input não muda) ...
                return;
            }
            
            // --- LÓGICA DE DEPURACAO ADICIONADA ---
            if (interaction.isModalSubmit()) {
                try {
                    let modal = this.modals.get(interaction.customId);
                    
                    if (!modal) {
                        console.log(`[DEBUG] (ModalSubmit) Modal de ID exato não encontrado para ${interaction.customId}.`);
                        console.log(`[DEBUG] (ModalSubmit) Procurando em chaves dinâmicas: [${Array.from(this.modals.keys()).join(', ')}]`);
                        
                        const modalKey = Array.from(this.modals.keys()).find(key => interaction.customId.startsWith(key));
                        
                        if (modalKey) {
                            console.log(`[DEBUG] (ModalSubmit) Correspondência dinâmica encontrada! Chave: ${modalKey}`);
                            modal = this.modals.get(modalKey);
                        }
                    }
                    
                    if (modal) {
                        await modal(interaction, this); 
                    } else {
                        console.warn(`[AVISO] (ModalSubmit) Handler de modal não encontrado para o ID: ${interaction.customId}`);
                        if (interaction.isRepliable()) {
                             await interaction.reply({ content: "Este formulário não foi encontrado. Pode ser uma mensagem antiga.", ephemeral: true });
                        }
                    }
                } catch (error: any) {
                    console.error("!!!!!!!!!!!! ERRO (ModalSubmit) !!!!!!!!!!!!", error);
                    if (interaction.isRepliable()) {
                        const payload = { content: "Ocorreu um erro ao submeter este formulário.", ephemeral: true };
                        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                        else await interaction.reply(payload);
                    }
                }
                return;
            }
            // --- FIM DA LÓGICA DE DEPURACAO ---
            
            if (interaction.isButton()) {
                try {
                    let button = this.buttons.get(interaction.customId);
                    if (!button) {
                        // console.log(`[DEBUG] Botão de ID exato não encontrado para ${interaction.customId}.`);
                        // console.log(`[DEBUG] Procurando em chaves dinâmicas: [${Array.from(this.buttons.keys()).join(', ')}]`);
                        const buttonKey = Array.from(this.buttons.keys()).find(key => interaction.customId.startsWith(key));
                        if (buttonKey) {
                            // console.log(`[DEBUG] Correspondência dinâmica encontrada! Chave: ${buttonKey}`);
                            button = this.buttons.get(buttonKey);
                        }
                    }

                    if (button) {
                        await button(interaction, this);
                    } else {
                        console.warn(`[AVISO]: Handler de botão não encontrado para o ID: ${interaction.customId}`);
                        if (interaction.isRepliable()) {
                             await interaction.reply({ content: "Este botão não foi encontrado. Pode ser uma mensagem antiga.", ephemeral: true });
                        }
                    }
                } catch (error: any) {
                    console.error("!!!!!!!!!!!! ERRO (Button) !!!!!!!!!!!!", error);
                    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: "Ocorreu um erro ao processar este botão.", ephemeral: true });
                    }
                }
                return;
            }
            
            if (interaction.isStringSelectMenu()) {
                // ... (lógica do select menu não muda) ...
                return;
            }
        });

        this.on(Events.Error, (error) => {
            console.error("!!!!!!!!!!!! ERRO GERAL DO CLIENTE !!!!!!!!!!!!", error);
        });
    }
    
    public async start() {
        await this.registerCommands();
        this.registerListeners();      
        
        console.log("[CLIENTE]: Logando...");
        this.login(process.env.BOT_TOKEN);
    }
}