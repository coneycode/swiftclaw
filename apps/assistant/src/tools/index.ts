export { codeExecute } from './code-execute.js'
export { fileRead, fileWrite, listDir } from './file-system.js'
export { shellRun } from './shell.js'

import { codeExecute } from './code-execute.js'
import { fileRead, fileWrite, listDir } from './file-system.js'
import { shellRun } from './shell.js'
import type { SwiftClawTool } from 'swiftclaw'

export const allTools: Record<string, SwiftClawTool> = {
  code_execute: codeExecute as SwiftClawTool,
  file_read: fileRead as SwiftClawTool,
  file_write: fileWrite as SwiftClawTool,
  list_dir: listDir as SwiftClawTool,
  shell_run: shellRun as SwiftClawTool,
}
