import { 
    Client, Partials, IntentsBitField, BitFieldResolvable, 
    GatewayIntentsString, Collection, Interaction, REST, Routes, 
    ApplicationCommandData
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
        const commands: ApplicationCommandData[] = [];
        const commandFiles = await glob(path.join(__dirname, "..", "commands", "**", "*.{ts,js}"));

        console.log(`[COMANDOS]: Carregando ${commandFiles.length} comandos...`);

        for (const file of commandFiles) {
            const commandModule = await import(file);
            const command: CommandType = commandModule.default;

            if (!command) continue;

            this.commands.set(command.name, command);
            commands.push(command);

            // MODIFICADO: Os handlers de modal agora são armazenados com um '_' no final
            // se eles esperam IDs dinâmicos.
            if (command.buttons) command.buttons.forEach((run, key) => this.buttons.set(key, run));
            if (command.modals) command.modals.forEach((run, key) => this.modals.set(key, run));
            if (command.selects) command.selects.forEach((run, key) => this.selects.set(key, run));
            
            console.log(`[COMANDOS]: Comando "${command.name}" carregado.`);
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
        this.on("interactionCreate", (interaction: Interaction) => {
            
            if (interaction.isChatInputCommand()) { 
                const command = this.commands.get(interaction.commandName);
                if (!command) return interaction.reply({ content: "Comando não encontrado.", ephemeral: true });
                
                command.run({ 
                    client: this, 
                    interaction: interaction,
                    options: interaction.options
                });
            }
            
            // LÓGICA DE MODAL ATUALIZADA
            else if (interaction.isModalSubmit()) {
                // Tenta encontrar uma correspondência exata primeiro
                let modal = this.modals.get(interaction.customId);
                
                if (!modal) {
                    // Se falhar, procura por um handler dinâmico (que começa com o ID)
                    const modalKey = Array.from(this.modals.keys())
                        .find(key => interaction.customId.startsWith(key));
                    
                    if (modalKey) {
                        modal = this.modals.get(modalKey);
                    }
                }
                
                // Passa 'this' (o client) para o handler
                if (modal) modal(interaction, this); 
            }
            
            else if (interaction.isButton()) {
                 const button = this.buttons.get(interaction.customId);
                 if (button) button(interaction);
            }
            else if (interaction.isStringSelectMenu()) {
                 const select = this.selects.get(interaction.customId);
                 if (select) select(interaction);
            }
        });
    }
    
    public async start() {
        await this.registerCommands();
        this.registerListeners();      
        
        console.log("[CLIENTE]: Logando...");
        this.login(process.env.BOT_TOKEN);
    }
}