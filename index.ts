export type TupleType =
   | 'BLACKANDWHITE'
   | 'GRAYSCALE'
   | 'RGB'
   | 'BLACKANDWHITE_ALPHA'
   | 'GRAYSCALE_ALPHA'
   | 'RGB_ALPHA';

function isSpace(char: string): boolean {
   return (
      char === '\t' || char === '\n' || char === '\v' || char === '\r' || char === ' '
   );
}

export class PNMDecoder {
   private buffer?: Uint8Array;

   public data: Uint8Array | Uint16Array = new Uint8Array(0);

   public width = 0;

   public height = 0;

   public depth = 0;

   public tupltype: TupleType = 'BLACKANDWHITE';

   public maxval = 0;

   constructor(private reader: (size: number) => ArrayBuffer) {}

   private peekByte(): number {
      if (this.buffer === undefined || this.buffer.length < 1) {
         this.buffer = new Uint8Array(this.reader(65536));
         if (this.buffer.length < 1) {
            throw new Error('Expected byte, got end of file');
         }
      }
      return this.buffer[0];
   }

   private skipByte(): void {
      if (this.buffer !== undefined) {
         this.buffer = this.buffer.subarray(1);
      }
   }

   private readByte(): number {
      const byte = this.peekByte();
      this.skipByte();
      return byte;
   }

   private readInt(): number {
      if (this.maxval <= 0xff) {
         return this.readByte();
      }
      const high = this.readByte();
      const low = this.readByte();
      return low | (high << 8);
   }

   private peekChar(): string {
      const byte = this.peekByte();
      if (byte > 0x7f) {
         throw new Error(`Expected ASCII character, got byte ${byte}`);
      }

      const char = String.fromCharCode(byte);
      if (char === '#') {
         while (this.peekByte() !== 0x0a) {
            this.skipByte();
         }
         return this.peekChar();
      }
      return char;
   }

   private readChar(): string {
      const char = this.peekChar();
      this.skipByte();
      return char;
   }

   private skipSpace(): void {
      while (isSpace(this.peekChar())) {
         this.skipByte();
      }
   }

   private readString(): string {
      this.skipSpace();
      let string = '';
      let char = this.peekChar();
      while (!isSpace(char)) {
         string += char;
         this.skipByte();
         char = this.peekChar();
      }
      return string;
   }

   private readNumber(): number {
      const number = parseInt(this.readString(), 10);
      if (Number.isNaN(number)) {
         throw new Error(`Expected number, got ${number}`);
      }
      return number;
   }

   private buildImage(pixel: (x: number, y: number) => number): void {
      const size = this.width * this.height * this.depth;
      if (this.maxval > 0xff) {
         this.data = new Uint16Array(size);
      } else {
         this.data = new Uint8Array(size);
      }

      for (let y = 0; y < this.height; y += 1) {
         for (let x = 0; x < this.width; x += 1) {
            for (let i = 0; i < this.depth; i += 1) {
               const index = (y * this.width + x) * this.depth + i;
               this.data[index] = pixel(x, y);
            }
         }
      }
   }

   private decodeHeader(maxval: boolean): void {
      this.width = this.readNumber();
      this.height = this.readNumber();
      if (maxval) {
         this.maxval = this.readNumber();
      }
      this.readByte();
   }

   private decodeP1(): void {
      this.depth = 1;
      this.tupltype = 'BLACKANDWHITE';
      this.maxval = 1;
      this.decodeHeader(false);
      this.buildImage(() => {
         this.skipSpace();
         const char = this.readChar();
         if (char === '0') {
            return 1;
         }
         if (char === '1') {
            return 0;
         }
         throw new Error(`Expected 0 or 1, got '${char}'`);
      });
   }

   private decodeP2(): void {
      this.depth = 1;
      this.tupltype = 'GRAYSCALE';
      this.decodeHeader(true);
      this.buildImage(() => this.readNumber());
   }

   private decodeP3(): void {
      this.depth = 3;
      this.tupltype = 'RGB';
      this.decodeHeader(true);
      this.buildImage(() => this.readNumber());
   }

   private decodeP4(): void {
      this.depth = 1;
      this.tupltype = 'BLACKANDWHITE';
      this.maxval = 1;
      this.decodeHeader(false);

      let byte = 0;
      this.buildImage((x) => {
         const shift = x % 8;
         if (shift === 0) {
            byte = ~this.readByte();
         }
         return (byte >> (7 - shift)) & 1;
      });
   }

   private decodeP5(): void {
      this.depth = 1;
      this.tupltype = 'GRAYSCALE';
      this.decodeHeader(true);
      this.buildImage(() => this.readInt());
   }

   private decodeP6(): void {
      this.depth = 3;
      this.tupltype = 'RGB';
      this.decodeHeader(true);
      this.buildImage(() => this.readInt());
   }

   private decodeP7(): void {
      let tupltype = false;
      let tag = this.readString();
      while (tag !== 'ENDHDR') {
         switch (tag) {
            case 'WIDTH':
               this.width = this.readNumber();
               break;
            case 'HEIGHT':
               this.height = this.readNumber();
               break;
            case 'TUPLTYPE':
               this.tupltype = this.readString() as TupleType;
               tupltype = true;
               break;
            case 'MAXVAL':
               this.maxval = this.readNumber();
               break;
            case 'DEPTH':
               this.depth = this.readNumber();
               break;
            default:
               console.warn(`Unknown PAM tag: ${this.readString()}`);
               break;
         }
         tag = this.readString();
      }
      this.readByte();

      if (!tupltype) {
         switch (this.depth) {
            case 0:
            case 1:
               this.tupltype = 'GRAYSCALE';
               break;
            case 2:
               this.tupltype = 'GRAYSCALE_ALPHA';
               break;
            case 3:
               this.tupltype = 'RGB';
               break;
            default:
               this.tupltype = 'RGB_ALPHA';
         }
      }

      this.buildImage(() => this.readInt());
   }

   decode(): void {
      const p = this.readChar();
      if (p !== 'P') {
         throw new Error(`Expected P, got '${p}'`);
      }
      const type = this.readChar();
      const space = this.readChar();
      if (!isSpace(space)) {
         throw new Error(`Expected space, got '${space}'`);
      }

      switch (type) {
         case '1':
            return this.decodeP1();
         case '2':
            return this.decodeP2();
         case '3':
            return this.decodeP3();
         case '4':
            return this.decodeP4();
         case '5':
            return this.decodeP5();
         case '6':
            return this.decodeP6();
         case '7':
            return this.decodeP7();
         default:
            throw new Error(`Unknown type ${type}`);
      }
   }
}
