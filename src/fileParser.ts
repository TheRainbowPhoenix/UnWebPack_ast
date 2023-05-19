export type TODOTypeMe = any;

export default interface FileParser {
  /**
   * Determines if this file can be parsed by the parser
   * @param args args
   */
  isParseable(args: TODOTypeMe): Promise<boolean>;

  /**
   * Parses the file into module
   * @param args args
   */
  parse(args: TODOTypeMe): Promise<TODOTypeMe[]>;
}
