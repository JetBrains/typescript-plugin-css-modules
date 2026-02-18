import { SourceMapConsumer } from 'source-map-js';
import { CustomTemplate, Options } from '../options';
import { transformClasses } from './classTransforms';
import { CSSExportsWithSourceMap } from './getCssExports';
import { VALID_VARIABLE_REGEXP } from './validVarRegexp';
import { Logger } from './logger';
import assert from 'node:assert';

const isValidVariable = (classname: string) =>
  VALID_VARIABLE_REGEXP.test(classname);

const flattenClassNames = (
  previousValue: string[] = [],
  currentValue: string[],
) => previousValue.concat(currentValue);

export const createDtsExports = ({
  cssExports,
  fileName,
  logger,
  options,
}: {
  cssExports: CSSExportsWithSourceMap;
  fileName: string;
  logger: Logger;
  options: Options;
}): string => {
  const classes = cssExports.classes;

  const possiblyUndefined = Boolean(options.noUncheckedIndexedAccess);

  const classnameToIndentedProperty = (classname: string) =>
    `  '${classname}'${possiblyUndefined ? '?' : ''}: string;`;
  const classnameToNamedExport = (classname: string) =>
    `export let ${classname}: string${
      possiblyUndefined ? ' | undefined' : ''
    };`;

  const processedClasses = Object.keys(classes)
    .map(transformClasses(options.classnameTransform))
    .reduce(flattenClassNames, []);

  let dts = '';

  const namedWithGoToDefinition =
    (options.goToDefinition === true || options.goToDefinition === 'named') &&
    !!cssExports.sourceMap;
  const defaultWithGoToDefinition =
    options.goToDefinition === 'default' && !!cssExports.sourceMap;
  const namedSimple =
    options.namedExports !== false && !namedWithGoToDefinition;
  const defaultSimple = !defaultWithGoToDefinition;

  if (namedWithGoToDefinition || defaultWithGoToDefinition) {
    assert(cssExports.sourceMap);

    // Create a new source map consumer.
    const smc = new SourceMapConsumer(cssExports.sourceMap);

    // Split original CSS file into lines.
    const cssLines = cssExports.css?.split('\n') ?? [];

    // Create new equal size array of empty strings.
    const dtsLines = Array.from(Array(cssLines.length), () => '');

    if (defaultWithGoToDefinition) {
      dtsLines[0] += 'declare let _classes: {';
    }

    // Create a list of filtered classnames and hashed classnames.
    const filteredClasses = Object.entries(cssExports.classes)
      .map(([classname, originalClassname]) => [
        // TODO: Improve this. It may return multiple valid classnames and we
        // want to handle all of those.
        transformClasses(options.classnameTransform)(classname)[0],
        originalClassname,
      ])
      .filter(
        ([classname]) =>
          defaultWithGoToDefinition || isValidVariable(classname),
      );

    filteredClasses.forEach(([classname, originalClassname]) => {
      let matchedLine;
      let matchedColumn;

      for (let i = 0; i < cssLines.length; i++) {
        const match = new RegExp(
          // NOTE: This excludes any match not starting with:
          // - `.` for classnames,
          // - `:` or ` ` for animation names,
          // and any matches followed by valid CSS selector characters.
          `[:.\\s]${originalClassname}(?![_a-zA-Z0-9-])`,
          'g',
        ).exec(cssLines[i]);

        if (match) {
          matchedLine = i;
          matchedColumn = match.index;
          break;
        }
      }

      const { line: lineNumber } = smc.originalPositionFor({
        // Lines start at 1, not 0.
        line: matchedLine ? matchedLine + 1 : 1,
        column: matchedColumn ? matchedColumn : 0,
      });

      dtsLines[lineNumber ? lineNumber - 1 : 0] += defaultWithGoToDefinition
        ? classnameToIndentedProperty(classname)
        : classnameToNamedExport(classname);
    });

    dts = dtsLines.join('\n');

    if (defaultWithGoToDefinition) {
      dts += '\n};\nexport default _classes;\n';
    }
  }

  if (defaultSimple) {
    dts += 'declare let _classes: {\n';
    for (const classname of processedClasses) {
      dts += classnameToIndentedProperty(classname) + '\n';
    }
    if (options.allowUnknownClassnames) {
      dts += '  [key: string]: string;\n';
    }
    dts += '};\nexport default _classes;\n';
  }

  if (namedSimple) {
    for (const classname of processedClasses) {
      if (isValidVariable(classname))
        dts += classnameToNamedExport(classname) + '\n';
    }
  }

  if (options.customTemplate) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const customTemplate = require(options.customTemplate) as CustomTemplate;
    return customTemplate(dts, {
      classes,
      fileName,
      logger,
    });
  }

  return dts;
};
