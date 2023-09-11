#!/usr/bin/env node
/**
 * @typedef {import('codeclimate-types').Issue} Issue
 */

const { createHash } = require('node:crypto')
const readline = require('readline');
const { dirname, join, relative, resolve } = require('node:path')
const { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')

const {
    CI_COMMIT_SHORT_SHA,
    CI_CONFIG_PATH = '.gitlab-ci.yml',
    CI_JOB_NAME = 'eslint',
    CI_PROJECT_DIR = process.cwd(),
    CI_PROJECT_URL,
    TYPESCRIPT_CODE_QUALITY_REPORT,
    GITLAB_CI
} = process.env

/**
 * @type {yaml.CollectionTag}
 */
const reference = {
    tag: '!reference',
    collection: 'seq',
    default: false,
    resolve() {
      // We only allow the syntax. We don’t actually resolve the reference.
    }
  }
  

  
/**
 * @typedef { import("stream").Readable } Readable
 * @typedef { import("stream").Writable } Writable
 */

/**
 * @param {Readable} input
 * @param {Writable} output
 */
async function main(input, output) {
    if (process.stdin.isTTY) {
        throw new Error("expected input to be piped in");
    }

    const parser = newParser();

    const rl = readline.createInterface({
        input,
        crlfDelay: Infinity
    })
    for await (const line of rl) {
        console.log('parse', line)
        parser.parse(line);
    }

    toJSON(parser.errors);

    return parser.errors.length ? 1 : 0
}

/**
 * @typedef {object} Parser
 * @property {CompilerError[]} errors
 * @property {(line: string) => void} parse
 *
 * @typedef {object} CompilerError
 * @property {string} filename
 * @property {number} line
 * @property {number} col
 * @property {string} code
 * @property {string} message
 * @property {string} [source]
 */

// We only handle the format without --pretty right now
const UGLY_REGEX = /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\): error (?<code>\S+?): (?<message>.+)$/;
const ERROR_WITHOUT_FILE_REGEX = /error (?<code>\S+?): (?<message>.+)$/;

/**
 * @returns {Parser}
 */
function newParser() {
    const errors = [];
    const hashes = new Set()


    function parse(line) {
        const match = UGLY_REGEX.exec(line);
        const errorWithoutFileMatch = ERROR_WITHOUT_FILE_REGEX.exec(line);

        if (match) {
            errors.push({
                type: 'issue',
                categories: ['Bug Risk'],
                check_name: match.groups.code,
                description: match.groups.message,
                severity: 'major', // message.fatal ? 'critical' : message.severity === 2 ? 'major' : 'minor',
                fingerprint: createFingerprint(match.groups.file, match.groups.message, hashes),
                location: {
                    path: match.groups.file,
                    lines: {
                        begin: Number(match.groups.line),
                        column: Number(match.groups.col),
                        end: Number(match.groups.line)
                    }
                }
                // filename: match.groups.file,
                // line: Number(match.groups.line),
                // col: Number(match.groups.col),
                // code: match.groups.code,
                // message: match.groups.message,
            });
        } else if (errorWithoutFileMatch) {
            errors.push({
                code: errorWithoutFileMatch.groups.code,
                message: errorWithoutFileMatch.groups.message,
                filename: 'unknown',
                col: 0,
                line: 0,
            });
        }
    }
    return { errors, parse };
}

/**
 * @param {Issue[]} issues
 * @returns {string}
 */
function toJSON(issues) {
    const outputPath = TYPESCRIPT_CODE_QUALITY_REPORT || 'gl-codequality.json'
    if(existsSync(outputPath)) {
        const inputRaw = readFileSync(outputPath, 'utf8');
        const existingIssues = JSON.parse(inputRaw);
        issues = [...existingIssues, ...issues];
    }
    const dir = dirname(outputPath)
    mkdirSync(dir, { recursive: true })
    writeFileSync(outputPath, JSON.stringify(issues, null, 2))
}

/**
 * @param {string} filePath The path to the linted file.
 * @param {string} message The Typescript report message.
 * @param {Set<string>} hashes Hashes already encountered. Used to avoid duplicate hashes
 * @returns {string} The fingerprint for the Typescript report message.
 */
function createFingerprint(filePath, message, hashes) {
    const md5 = createHash('md5')
    md5.update(filePath)
    md5.update(message)

    // Create copy of hash since md5.digest() will finalize it, not allowing us to .update() again
    let md5Tmp = md5.copy()
    let hash = md5Tmp.digest('hex')

    while (hashes.has(hash)) {
        // Hash collision. This happens if we encounter the same ESLint message in one file
        // multiple times. Keep generating new hashes until we get a unique one.
        md5.update(hash)

        md5Tmp = md5.copy()
        hash = md5Tmp.digest('hex')
    }

    hashes.add(hash)
    return hash
}


if (require.main) {
    main(process.stdin, process.stdout)
        .catch(err => {
            console.error("ERROR: " + err.message);
            return 1;
        })
        .then(code => {
            process.exit(code);
        });
}