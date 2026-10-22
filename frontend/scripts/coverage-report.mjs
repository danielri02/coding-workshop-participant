import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import libCoverage from 'istanbul-lib-coverage'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'
import libSourceMaps from 'istanbul-lib-source-maps'

// Unit coverage supplies every application file, including code never loaded by a test.
const coverage = libCoverage.createCoverageMap(
  JSON.parse(readFileSync('coverage/unit/coverage-final.json', 'utf8')),
)
const browserFiles = readdirSync('coverage/browser').filter((file) => file.endsWith('.json'))
if (!browserFiles.length) throw new Error('Run test:e2e:coverage before combining coverage.')
const browser = libCoverage.createCoverageMap({})
for (const file of browserFiles)
  browser.merge(JSON.parse(readFileSync(`coverage/browser/${file}`, 'utf8')))
if (!browser.files().length || !browser.getCoverageSummary().statements.covered)
  throw new Error('Browser coverage is empty; verify test instrumentation is enabled.')
const remapped = await libSourceMaps.createSourceMapStore().transformCoverage(browser)
// Remapping uses Infinity for end columns; saved unit JSON represents it as null.
// Normalize both to the persisted format so identical source counters merge once.
coverage.merge(JSON.parse(JSON.stringify(remapped)))

// Both providers remap instrumented TypeScript/JSX back to the original source.
const directory = resolve('coverage/combined')
mkdirSync(directory, { recursive: true })
const context = libReport.createContext({ dir: directory, coverageMap: coverage })
for (const reporter of ['text', 'html', 'json', 'json-summary', 'lcovonly'])
  reports.create(reporter).execute(context)
