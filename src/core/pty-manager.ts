import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import os from 'os';

export interface PtyManagerOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface PtyDataEvent {
  /** Raw data with ANSI codes intact (for display) */
  raw: string;
  /** Cleaned data with ANSI codes stripped (for parsing) */
  clean: string;
  /** Timestamp of when data was received */
  timestamp: number;
}

/**
 * PtyManager wraps node-pty to provide a transparent interception layer.
 * 
 * The agent process runs inside a pseudo-terminal, meaning it behaves
 * exactly as if launched directly — full TUI support, colors, cursor
 * positioning, etc. But we get a hook into every byte of I/O.
 * 
 * Data flow:
 *   Agent stdout → onData → (our analysis) → process.stdout (user sees it)
 *   User stdin  → process.stdin → (our analysis) → agent stdin
 */
export class PtyManager extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private stripAnsi: ((text: string) => string) | null = null;

  /** Buffer accumulating output between user inputs for analysis */
  private outputBuffer: string = '';

  /** Cap the output buffer at 64KB to prevent unbounded memory growth */
  private static readonly MAX_BUFFER_SIZE = 64 * 1024;

  /** Total bytes the agent has written to stdout */
  public totalBytesOut: number = 0;

  /** Total bytes the user has written to stdin */
  public totalBytesIn: number = 0;

  /** Whether the PTY process is currently running */
  public isRunning: boolean = false;

  /** References for cleanup */
  private onStdinData: ((data: Buffer) => void) | null = null;
  private onResize: (() => void) | null = null;

  async spawn(options: PtyManagerOptions): Promise<number> {
    // strip-ansi is ESM-only, must use dynamic import
    const stripAnsiModule = await import('strip-ansi');
    this.stripAnsi = stripAnsiModule.default;

    const cols = options.cols ?? process.stdout.columns ?? 120;
    const rows = options.rows ?? process.stdout.rows ?? 30;

    return new Promise<number>((resolve, reject) => {
      try {
        // On Windows, node-pty's spawn uses CreateProcess directly, which
        // cannot resolve .cmd/.bat wrappers (e.g., 'opencode.cmd', 'claude.cmd'
        // installed via npm). Route through cmd.exe /c to let Windows handle
        // PATH resolution and extension matching — same as typing in a terminal.
        const isWindows = os.platform() === 'win32';
        const spawnCommand = isWindows ? 'cmd.exe' : options.command;
        const spawnArgs = isWindows
          ? ['/c', options.command, ...options.args]
          : options.args;

        this.ptyProcess = pty.spawn(spawnCommand, spawnArgs, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: options.cwd ?? process.cwd(),
          env: {
            ...process.env,
            ...(options.env ?? {}),
            // Ensure the child process knows it has color support
            FORCE_COLOR: '1',
            TERM: 'xterm-256color',
          } as Record<string, string>,
        });

        this.isRunning = true;

        // --- Agent output → our analysis + user display ---
        this.ptyProcess.onData((rawData: string) => {
          this.totalBytesOut += rawData.length;
          const cleanData = this.stripAnsi!(rawData);

          // Append to buffer, but cap it to prevent memory issues
          this.outputBuffer += cleanData;
          if (this.outputBuffer.length > PtyManager.MAX_BUFFER_SIZE) {
            this.outputBuffer = this.outputBuffer.slice(-PtyManager.MAX_BUFFER_SIZE);
          }

          const event: PtyDataEvent = {
            raw: rawData,
            clean: cleanData,
            timestamp: Date.now(),
          };

          // Emit for listeners (loop detector, analytics, etc.)
          this.emit('data', event);

          // Forward to real terminal so user sees everything
          try {
            process.stdout.write(rawData);
          } catch {
            // EAGAIN: stdout not writable (terminal closing) — ignore
          }
        });

        // --- User keyboard → our tracking + agent stdin ---
        this.onStdinData = (data: Buffer) => {
          if (!this.ptyProcess || !this.isRunning) return;

          const str = data.toString();
          this.totalBytesIn += str.length;

          // When user sends input, emit the buffered output as a "turn"
          // so the loop detector can analyze complete agent responses
          if (this.outputBuffer.trim().length > 0) {
            this.emit('agent-turn', this.outputBuffer);
            this.outputBuffer = '';
          }

          this.emit('user-input', str);
          this.ptyProcess.write(str);
        };

        // Set raw mode so we get individual keystrokes
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.on('data', this.onStdinData);

        // Handle terminal resize
        this.onResize = () => {
          if (this.ptyProcess && this.isRunning) {
            this.ptyProcess.resize(
              process.stdout.columns ?? cols,
              process.stdout.rows ?? rows
            );
          }
        };
        process.stdout.on('resize', this.onResize);

        // --- Handle SIGINT/SIGTERM gracefully ---
        const onSignal = () => {
          this.cleanup();
        };
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);

        // --- Process exit ---
        this.ptyProcess.onExit(({ exitCode }) => {
          this.isRunning = false;

          // Emit final buffered output
          if (this.outputBuffer.trim().length > 0) {
            this.emit('agent-turn', this.outputBuffer);
            this.outputBuffer = '';
          }

          // Cleanup
          this.cleanup();
          process.removeListener('SIGINT', onSignal);
          process.removeListener('SIGTERM', onSignal);

          this.emit('exit', exitCode);
          resolve(exitCode);
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Clean up stdin/stdout listeners and restore terminal state.
   * Safe to call multiple times.
   */
  private cleanup(): void {
    if (this.onStdinData) {
      process.stdin.removeListener('data', this.onStdinData);
      this.onStdinData = null;
    }
    if (this.onResize) {
      process.stdout.removeListener('resize', this.onResize);
      this.onResize = null;
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // May already be destroyed
      }
    }
    process.stdin.pause();
  }

  /**
   * Write data directly to the agent's stdin.
   * Used by the loop detector to inject nudge messages.
   */
  write(data: string): void {
    if (this.ptyProcess && this.isRunning) {
      this.ptyProcess.write(data);
    }
  }

  /**
   * Get the current output buffer without clearing it.
   */
  getOutputBuffer(): string {
    return this.outputBuffer;
  }

  /**
   * Kill the PTY process.
   */
  kill(): void {
    if (this.ptyProcess && this.isRunning) {
      this.ptyProcess.kill();
    }
  }
}
