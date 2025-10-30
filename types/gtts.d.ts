declare module "gtts" {
  export default class gTTS {
    constructor(
      text: string,
      lang?: string,
      slow?: boolean,
      host?: string
    );
    save(
      filePath: string,
      callback: (error: Error | undefined | null) => void
    ): void;
  }
}
