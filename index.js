const fs = require('fs');
const path = require('path');
const ncc = require('@vercel/ncc');

const extractTags = new RegExp(
  /(\((?<body>\w+)\)\s+)?\{(?<schemaDef>\w+)\}\s+(?<apidocTarget>\w+)/
);

async function extractFromTypescript(modulePath, target) {
  const { code } = await ncc(modulePath);
  const imported = eval(code);

  return imported[target];
}

async function extractFromJavascript(modulePath, target) {
  const imported = require(modulePath);
  return imported[target];
}

function convertScalarType(type) {
  switch (type) {
    case 'string':
      return 'String';
      break;

    default:
      console.warn(`!! DON'T KNOW HOW TO CONVERT: ${type}`);
      return 'String';
  }
}

function buildParams(object, target) {
  let params = [];

  for (const key in object) {
    const item = object[key];

    const description =
      item.flags && item.flags.description
        ? item.flags.description
        : 'No description';
    const content = `{${convertScalarType(item.type)}} ${description}`;

    // console.log(`${key} => `, item);
    params.push({
      source: `@${target} ${content}`,
      name: target.toLowerCase(),
      sourceName: target,
      content,
    });
  }

  return params;
}

async function parserSchemaElements(elements, element, block, filename) {
  // We only care about apiJoiSchema...
  if (element.name !== 'apijoischema') return elements;
  console.log('START ==> ', elements);

  const filePath = path.parse(filename);

  console.log(`Found '${element.name}' in ${filename}`, element);
  const match = extractTags.exec(element.content);
  if (!match.groups) return elements;
  const { body, schemaDef, apidocTarget } = match.groups;

  // Remove the pseudo-element, we're going to build up a new set and
  // add those to `elements` instead
  elements.pop();
  const elementsLen = elements.length;

  // Resolve the filename to a module path and import everything from the target
  const absModulePath = [process.cwd(), filename].join(path.sep);
  let validator;
  switch (filePath.ext) {
    case '.js':
    case '.jsx':
      validator = await extractFromJavascript(absModulePath, schemaDef);
      break;

    case '.ts':
    case '.tsx':
      validator = await extractFromTypescript(absModulePath, schemaDef);
      break;

    default:
      throw new Error(`apidoc-plugin-joi: unsupported filetype ${path.ext}`);
  }

  const description = validator.describe();
  const newParams = buildParams(description.keys, apidocTarget);

  // Horrific hack because of async
  elements.splice(elementsLen, 0, newParams);
  console.log('AFTER ==>  ', elements);
  return elements;
}

let app = {};
module.exports = {
  init: function (_app) {
    app = _app;
    app.addHook('parser-find-elements', parserSchemaElements, 10);
  },
};
