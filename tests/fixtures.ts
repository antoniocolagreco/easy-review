export const SERVICE_DIFF = `diff --git a/src/service.ts b/src/service.ts
index 1111111..2222222 100644
--- a/src/service.ts
+++ b/src/service.ts
@@ -10,4 +10,9 @@ export function suspend(agreement) {
 const log = logger()
-import { old } from './old'
+import { fresh } from './fresh'
+const isOwner = user.id === agreement.ownerId
+if (!isOwner) {
+  throw forbidden
+}
+const label = 'suspended'
 return agreement
 end()
`

export const SERVICE_NUMSTAT = '6\t1\tsrc/service.ts\0'

export const TWO_FILES_DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-const a = 1
+const a = 2
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-const b = 1
+const b = 2
diff --git a/c.ts b/c.ts
--- a/c.ts
+++ b/c.ts
@@ -1 +1 @@
-const c = 1
+const c = 2
diff --git a/d.ts b/d.ts
--- a/d.ts
+++ b/d.ts
@@ -1 +1 @@
-const d = 1
+const d = 2
diff --git a/e.ts b/e.ts
--- a/e.ts
+++ b/e.ts
@@ -1 +1 @@
-const e = 1
+const e = 2
diff --git a/f.ts b/f.ts
--- a/f.ts
+++ b/f.ts
@@ -1 +1 @@
-const f = 1
+const f = 2
`

export const TWO_FILES_NUMSTAT = '1\t1\ta.ts\x001\t1\tb.ts\x001\t1\tc.ts\x001\t1\td.ts\x001\t1\te.ts\x001\t1\tf.ts\x00'

export const SERVICE_REPLY = JSON.stringify({
  snippets: [
    { from: 1, to: 3, title: 'Boilerplate', impact: 0, reversibility: 0, detection: 0, summary: 'Swaps an import' },
    {
      from: 4,
      to: 7,
      title: 'Authorization',
      impact: 3,
      reversibility: 2,
      detection: 2,
      summary: 'Allows only the owner',
      description: 'Throws forbidden unless the user owns the agreement.',
    },
    { from: 8, to: 10, title: 'Boilerplate', impact: 1, reversibility: 0, detection: 1, summary: 'Sets a label' },
  ],
})

export const NEW_FILE_DIFF = `diff --git a/src/fresh.ts b/src/fresh.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/fresh.ts
@@ -0,0 +1,2 @@
+export const fresh = 1
+export const other = 2
`

export const RENAME_DIFF = `diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`

export const BINARY_DIFF = `diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`

export const MODE_DIFF = `diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`

export const CRLF_DIFF = 'diff --git a/win.txt b/win.txt\n--- a/win.txt\n+++ b/win.txt\n@@ -1 +1 @@\n-old\r\n+new\r\n'

export const ESC_DIFF = 'diff --git a/esc.txt b/esc.txt\n--- a/esc.txt\n+++ b/esc.txt\n@@ -1 +1 @@\n-old\n+a\u001b[31mb\n'

export const BIDI_DIFF = 'diff --git a/bidi.ts b/bidi.ts\n--- a/bidi.ts\n+++ b/bidi.ts\n@@ -1 +1 @@\n-old\n+a‮b\n'

export const QUOTED_DIFF = `diff --git "a/caff\\303\\250.ts" "b/caff\\303\\250.ts"
--- "a/caff\\303\\250.ts"
+++ "b/caff\\303\\250.ts"
@@ -1 +1 @@
-old
+new
`

export const WHITESPACE_DIFF = `diff --git a/src/format.ts b/src/format.ts
--- a/src/format.ts
+++ b/src/format.ts
@@ -1,2 +1,2 @@
-const a=1
-const b=2
+const a = 1
+const b = 2
`

export const PYTHON_WHITESPACE_DIFF = `diff --git a/src/format.py b/src/format.py
--- a/src/format.py
+++ b/src/format.py
@@ -1,2 +1,2 @@
-if a:
-  b()
+if a:
+b()
`

export const LOCK_WITH_MANIFEST_DIFF = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-"a": "1"
+"a": "2"
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-a: 1
+a: 2
`

export const LOCK_ALONE_DIFF = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-a: 1
+a: 2
`

export const AUTH_DIFF = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1 +1 @@
-const ttl = 10
+const ttl = 20
`

export const AUTHOR_DIFF = `diff --git a/src/author/name.ts b/src/author/name.ts
--- a/src/author/name.ts
+++ b/src/author/name.ts
@@ -1 +1 @@
-const a = 1
+const a = 2
`

export const LOW_RISK_REPLY = JSON.stringify({
  snippets: [{ from: 1, to: 2, title: 'Other', impact: 1, reversibility: 0, detection: 1, summary: 'Changes a value' }],
})

export const WORKED_EXAMPLES: readonly { name: string; scores: readonly [number, number, number]; risk: number; isHot: boolean }[] = [
  { name: 'Imports and logger setup', scores: [0, 0, 0], risk: 0, isHot: false },
  { name: 'Rename a tag in Terraform', scores: [1, 1, 1], risk: 2, isHot: false },
  { name: 'Call delete(id) after another part of the code has decided', scores: [1, 3, 1], risk: 4, isHot: false },
  { name: 'New validation rule on a request', scores: [2, 1, 2], risk: 6, isHot: true },
  { name: 'Timeout lowered from 30 seconds to 3', scores: [2, 1, 3], risk: 8, isHot: true },
  { name: 'CSS hides the consent banner', scores: [3, 1, 2], risk: 9, isHot: true },
  { name: 'New role allowed on a route', scores: [3, 2, 2], risk: 12, isHot: true },
  { name: 'A check removed from a route', scores: [3, 2, 2], risk: 12, isHot: true },
  { name: 'Condition that decides whether to delete data', scores: [3, 3, 2], risk: 15, isHot: true },
  { name: 'A log line prints a token', scores: [3, 3, 3], risk: 18, isHot: true },
]

export const PR_JSON = JSON.stringify({
  title: 'Add suspension',
  state: 'open',
  additions: 6,
  deletions: 1,
  changed_files: 1,
  user: { login: 'collaborator' },
  head: { sha: 'abc1234abc1234abc1234abc1234abc1234abc12', ref: 'feat/suspend' },
  base: { ref: 'main' },
})

export const PR_MOVED_JSON = JSON.stringify({
  title: 'Add suspension',
  state: 'open',
  additions: 6,
  deletions: 1,
  changed_files: 1,
  user: { login: 'collaborator' },
  head: { sha: 'def5678def5678def5678def5678def5678def56', ref: 'feat/suspend' },
  base: { ref: 'main' },
})

export const THREADS_JSON = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'thread-1',
              path: 'src/service.ts',
              line: 12,
              diffSide: 'RIGHT',
              isResolved: false,
              isOutdated: false,
              viewerCanReply: true,
              viewerCanResolve: true,
              viewerCanUnresolve: false,
              comments: {
                nodes: [
                  {
                    id: 'comment-1',
                    body: 'Is the owner check enough?',
                    author: { login: 'collaborator' },
                    viewerCanUpdate: false,
                    viewerCanDelete: false,
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
})
