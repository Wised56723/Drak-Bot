import { 
    ApplicationCommandData, 
    ButtonInteraction, 
    Collection, 
    CommandInteraction, 
    CommandInteractionOptionResolver, 
    Interaction, 
    ModalSubmitInteraction, 
    StringSelectMenuInteraction,
    CacheType,
    ChatInputCommandInteraction
} from "discord.js"
import { ExtendedClient } from "../ExtendedClient"

interface CommandProps {
    client: ExtendedClient,
    interaction: ChatInputCommandInteraction,
    options: Omit<CommandInteractionOptionResolver<CacheType>, "getMessage" | "getFocused"> 
}

// --- MODIFICAÇÕES AQUI ---
// Adicionamos o 'client: ExtendedClient' aos botões e menus, tal como fizemos com os modais.
export type ComponentsButton = Collection<string, (Interaction: ButtonInteraction, client: ExtendedClient) => any>;
export type ComponentsSelect = Collection<string, (Interaction: StringSelectMenuInteraction, client: ExtendedClient) => any>;
// --- FIM DAS MODIFICAÇÕES ---

export type ComponentsModal = Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>;

interface CommandComponents {
    buttons?: ComponentsButton,
    selects?: ComponentsSelect,
    modals?: ComponentsModal
}

export type CommandType = ApplicationCommandData & CommandComponents & {
    run(props: CommandProps): any;

}

export class Command {
    constructor(options: CommandType) {
        Object.assign(this, options);
    }
}