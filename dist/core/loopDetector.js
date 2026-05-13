export class LoopDetector {
    history = [];
    detectLoop(action) {
        // Basic MVP: check if action was repeated in last 3 turns
        const recent = this.history.slice(-3);
        const isLoop = recent.includes(action);
        this.history.push(action);
        if (this.history.length > 10) {
            this.history.shift();
        }
        return isLoop;
    }
}
