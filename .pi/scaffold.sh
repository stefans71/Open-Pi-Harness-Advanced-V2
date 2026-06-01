#!/usr/bin/env bash
set -euo pipefail

MODEL_SIZE="${MODEL_SIZE:-unknown}"
TECH_STACK="${TECH_STACK:-unknown}"
PROJECT_DIR="${PROJECT_DIR:-.}"

cd "$PROJECT_DIR"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

log() {
  printf '[scaffold] %s\n' "$*"
}

ensure_dir() {
  mkdir -p "$1"
}

write_if_missing() {
  local path="$1"
  local content="$2"
  if [ ! -e "$path" ]; then
    printf '%s' "$content" > "$path"
  fi
}

normalize_stack() {
  case "$TECH_STACK" in
    react|react_ts|react_tailwind) echo "react" ;;
    vue|vue_ts) echo "vue" ;;
    html|html_css|static_html|plain_html) echo "html" ;;
    *) echo "unknown" ;;
  esac
}

choose_mode() {
  local stack
  stack="$(normalize_stack)"

  if [ -f package.json ]; then
    echo "existing-project"
    return
  fi

  if [ "$MODEL_SIZE" = "small" ]; then
    echo "html"
    return
  fi

  case "$stack" in
    react) echo "react" ;;
    vue) echo "vue" ;;
    html) echo "html" ;;
    unknown)
      if [ "$MODEL_SIZE" = "medium" ]; then
        echo "html"
      else
        echo "react"
      fi
      ;;
  esac
}

scaffold_html() {
  log "scaffolding static HTML project"
  ensure_dir assets

  write_if_missing index.html '<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Project</title>
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>
'

  write_if_missing .gitignore 'node_modules
dist
.DS_Store
'
}

scaffold_react_vite() {
  log "scaffolding React + Vite project"

  cat > package.json <<'EOF'
{
  "name": "web-design-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5"
  }
}
EOF

  cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
EOF

  cat > vite.config.ts <<'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
EOF

  ensure_dir src

  write_if_missing index.html '<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Web Design App</title>
    <script type="module" src="/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
'

  write_if_missing src/main.tsx 'import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
'

  write_if_missing src/App.tsx 'export default function App() {
  return <main>App scaffolded successfully.</main>;
}
'

  write_if_missing .gitignore 'node_modules
dist
.DS_Store
'

  if have_cmd npm; then
    npm install
  else
    log "npm not found; skipped dependency installation"
  fi
}

scaffold_vue_vite() {
  log "scaffolding Vue + Vite project"

  cat > package.json <<'EOF'
{
  "name": "web-design-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "vue": "^3.4.38"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.2",
    "vite": "^5.4.2"
  }
}
EOF

  cat > vite.config.js <<'EOF'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
})
EOF

  ensure_dir src

  write_if_missing index.html '<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Web Design App</title>
    <script type="module" src="/src/main.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
'

  write_if_missing src/main.js 'import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
'

  write_if_missing src/App.vue '<template>
  <main>App scaffolded successfully.</main>
</template>
'

  write_if_missing .gitignore 'node_modules
dist
.DS_Store
'

  if have_cmd npm; then
    npm install
  else
    log "npm not found; skipped dependency installation"
  fi
}

ensure_existing_project_shape() {
  log "existing package.json detected; scaffolding conservatively"

  ensure_dir src
  write_if_missing .gitignore 'node_modules
dist
.DS_Store
'

  local stack
  stack="$(normalize_stack)"

  case "$stack" in
    react)
      write_if_missing src/App.tsx 'export default function App() {
  return <main>App scaffolded successfully.</main>;
}
'
      ;;
    vue)
      write_if_missing src/App.vue '<template>
  <main>App scaffolded successfully.</main>
</template>
'
      ;;
    *)
      write_if_missing index.html '<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Project</title>
  </head>
  <body>
    <main id="app"></main>
  </body>
</html>
'
      ;;
  esac
}

MODE="$(choose_mode)"
log "model_size=$MODEL_SIZE tech_stack=$TECH_STACK mode=$MODE"

case "$MODE" in
  existing-project) ensure_existing_project_shape ;;
  html) scaffold_html ;;
  react) scaffold_react_vite ;;
  vue) scaffold_vue_vite ;;
  *)
    log "unknown mode, falling back to static HTML"
    scaffold_html
    ;;
esac
