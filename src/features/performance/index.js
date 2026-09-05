// Performance entry point; each subsystem owns its hooks and state.
import { installChatCapacity } from './chat-capacity.js';
import { installTexturePerformance } from './textures.js';
import { installFramePerformance } from './frames.js';
export { doClearCaches } from './textures.js';

export function installPerformance() {
    installTexturePerformance();
    installFramePerformance();
    installChatCapacity();
}
