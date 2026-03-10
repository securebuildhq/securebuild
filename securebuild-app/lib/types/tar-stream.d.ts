declare module 'tar-stream' {
  import { Readable } from 'stream';

  interface Header {
    name: string;
    size?: number;
    mode?: number;
    mtime?: Date;
    type?: string;
    linkname?: string;
    uid?: number;
    gid?: number;
    uname?: string;
    gname?: string;
  }

  interface Pack {
    entry(header: Header, buffer: string | Buffer, callback: (err?: Error) => void): void;
    finalize(): void;
    on(event: string, listener: (...args: any[]) => void): this;
    write(chunk: Buffer): boolean;
    end(): void;
  }

  interface Extract {
    on(event: 'entry', listener: (header: Header, stream: Readable, next: () => void) => void): this;
    on(event: 'finish', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    write(chunk: Buffer): boolean;
    end(): void;
  }

  function pack(): Pack;
  function extract(): Extract;
}
