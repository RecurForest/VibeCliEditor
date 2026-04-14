import React, { useState } from 'react';
import { 
  Files, 
  Search, 
  GitBranch, 
  Play, 
  Blocks, 
  UserCircle, 
  Settings, 
  ChevronRight, 
  ChevronDown, 
  FileCode, 
  FileJson, 
  FileText, 
  Info, 
  MoreHorizontal, 
  Split, 
  PanelBottom, 
  X, 
  Plus, 
  Trash2, 
  Bell, 
  RefreshCw, 
  AlertCircle, 
  TriangleAlert,
  Code2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  icon?: React.ReactNode;
  color?: string;
  children?: FileNode[];
  isOpen?: boolean;
  isModified?: boolean;
  isNew?: boolean;
}

// --- Mock Data ---
const initialFiles: FileNode[] = [
  {
    id: 'root',
    name: 'MONOLITH-PROJECT',
    type: 'folder',
    isOpen: true,
    children: [
      {
        id: 'src',
        name: 'src',
        type: 'folder',
        isOpen: true,
        children: [
          {
            id: 'components',
            name: 'components',
            type: 'folder',
            isOpen: false,
          },
          {
            id: 'index-ts',
            name: 'index.ts',
            type: 'file',
            icon: <FileCode className="w-4 h-4 text-blue-400" />,
          },
          {
            id: 'styles-css',
            name: 'styles.css',
            type: 'file',
            icon: <FileCode className="w-4 h-4 text-orange-400" />,
            isModified: true,
          }
        ]
      },
      {
        id: 'tauri-src',
        name: 'tauri-src',
        type: 'folder',
        isOpen: false,
      },
      {
        id: 'package-json',
        name: 'package.json',
        type: 'file',
        icon: <FileJson className="w-4 h-4 text-yellow-400" />,
      },
      {
        id: 'readme-md',
        name: 'README.md',
        type: 'file',
        icon: <Info className="w-4 h-4 text-blue-400" />,
        isNew: true,
      }
    ]
  }
];

// --- Components ---

const ActivityBar = () => (
  <nav className="w-12 bg-surface-container-low flex flex-col justify-between py-4 border-r border-outline-variant/10">
    <div className="flex flex-col items-center gap-6">
      <div className="text-on-surface border-l-2 border-primary-container w-full flex justify-center py-2">
        <Files className="w-6 h-6" />
      </div>
      <div className="text-on-surface-variant opacity-80 hover:text-on-surface hover:opacity-100 transition-all cursor-pointer w-full flex justify-center py-2">
        <Search className="w-6 h-6" />
      </div>
      <div className="text-on-surface-variant opacity-80 hover:text-on-surface hover:opacity-100 transition-all cursor-pointer w-full flex justify-center py-2">
        <GitBranch className="w-6 h-6" />
      </div>
      <div className="text-on-surface-variant opacity-80 hover:text-on-surface hover:opacity-100 transition-all cursor-pointer w-full flex justify-center py-2">
        <Play className="w-6 h-6" />
      </div>
      <div className="text-on-surface-variant opacity-80 hover:text-on-surface hover:opacity-100 transition-all cursor-pointer w-full flex justify-center py-2">
        <Blocks className="w-6 h-6" />
      </div>
    </div>
    <div className="flex flex-col items-center gap-6">
      <div className="text-on-surface-variant opacity-80 hover:text-on-surface hover:opacity-100 transition-all cursor-pointer w-full flex justify-center py-2">
        <UserCircle className="w-6 h-6" />
      </div>
      <div className="text-on-surface-variant opacity-80 hover:text-on-surface hover:opacity-100 transition-all cursor-pointer w-full flex justify-center py-2">
        <Settings className="w-6 h-6" />
      </div>
    </div>
  </nav>
);

interface FileTreeItemProps {
  node: FileNode;
  level?: number;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(node.isOpen);
  
  return (
    <div>
      <div 
        className={`flex items-center gap-1 h-[22px] px-4 text-sm cursor-pointer hover:bg-surface-container-highest transition-colors ${node.id === 'index-ts' ? 'bg-primary-container/20 border-l-2 border-primary-container' : ''}`}
        style={{ paddingLeft: `${level * 12 + 16}px` }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {node.type === 'folder' ? (
          isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
        ) : null}
        
        {node.type === 'folder' ? (
          <Files className="w-4 h-4 text-blue-300" />
        ) : (
          node.icon || <FileText className="w-4 h-4 text-on-surface-variant" />
        )}
        
        <span className={`flex-1 truncate ${node.id === 'index-ts' ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>
          {node.name}
        </span>

        {node.isModified && <span className="text-[10px] text-orange-400 font-bold ml-2">M</span>}
        {node.isNew && <span className="text-[10px] text-green-400 font-bold ml-2">U</span>}
      </div>
      
      {isOpen && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeItem key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

const Sidebar = () => (
  <aside className="w-64 bg-surface-container flex flex-col select-none border-r border-outline-variant/10">
    <div className="h-9 flex items-center px-4 justify-between text-[11px] font-bold tracking-widest text-on-surface-variant uppercase">
      Explorer
      <MoreHorizontal className="w-4 h-4 cursor-pointer" />
    </div>
    <div className="flex-1 overflow-y-auto py-2">
      {initialFiles.map(node => (
        <FileTreeItem key={node.id} node={node} />
      ))}
    </div>
  </aside>
);

const TitleBar = () => (
  <header className="flex items-center w-full h-9 bg-surface border-b border-outline-variant/10 font-mono text-[13px] z-40">
    <div className="flex h-full">
      <div className="bg-surface text-on-surface border-t-2 border-primary-container px-4 flex items-center gap-2 cursor-pointer h-full">
        <FileCode className="w-3.5 h-3.5 text-blue-400" />
        index.ts
        <X className="w-3 h-3 ml-2 opacity-50 hover:opacity-100" />
      </div>
      <div className="bg-surface-container text-on-surface-variant px-4 flex items-center gap-2 cursor-pointer hover:bg-surface-container-high transition-colors h-full">
        <FileCode className="w-3.5 h-3.5 text-orange-400" />
        styles.css
        <div className="w-2 h-2 rounded-full bg-on-surface-variant/50 ml-2"></div>
        <X className="w-3 h-3 ml-1 opacity-50 hover:opacity-100" />
      </div>
      <div className="bg-surface-container text-on-surface-variant px-4 flex items-center gap-2 cursor-pointer hover:bg-surface-container-high transition-colors h-full">
        <Info className="w-3.5 h-3.5 text-on-surface-variant" />
        README.md
        <X className="w-3 h-3 ml-2 opacity-50 hover:opacity-100" />
      </div>
    </div>
    <div className="flex-1"></div>
    <div className="flex items-center gap-4 px-4 text-on-surface-variant">
      <Split className="w-4 h-4 cursor-pointer hover:text-on-surface" />
      <PanelBottom className="w-4 h-4 cursor-pointer hover:text-on-surface" />
      <X className="w-4 h-4 cursor-pointer hover:text-on-surface" />
    </div>
  </header>
);

const Editor = () => (
  <main className="flex-1 flex flex-col bg-surface overflow-hidden">
    {/* Breadcrumbs */}
    <div className="h-6 flex items-center px-4 bg-surface text-[11px] text-on-surface-variant gap-2 border-b border-outline-variant/10">
      <span>monolith-project</span>
      <ChevronRight className="w-3 h-3" />
      <span>src</span>
      <ChevronRight className="w-3 h-3" />
      <span className="text-on-surface">index.ts</span>
    </div>
    
    {/* Code Area */}
    <div className="flex-1 flex overflow-auto font-mono text-[14px] leading-relaxed relative">
      {/* Line Numbers */}
      <div className="w-12 bg-surface text-right pr-4 py-4 text-neutral-600 select-none border-r border-outline-variant/10">
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} className={i === 11 ? 'text-on-surface' : ''}>{i + 1}</div>
        ))}
      </div>
      
      {/* Editor Content */}
      <div className="flex-1 py-4 px-4 relative">
        {/* Active Line Highlight */}
        <div className="absolute top-[280px] left-0 right-0 h-[24px] bg-surface-container-highest/30 border-y border-outline-variant/10 pointer-events-none"></div>
        
        <pre className="relative z-10">
          <code>
            <span className="code-syntax-keyword">import</span> {'{ invoke }'} <span className="code-syntax-keyword">from</span> <span className="code-syntax-string">"@tauri-apps/api/tauri"</span>;<br />
            <span className="code-syntax-keyword">import</span> React, {'{ useState, useEffect }'} <span className="code-syntax-keyword">from</span> <span className="code-syntax-string">"react"</span>;<br />
            <br />
            <span className="code-syntax-keyword">interface</span> <span className="code-syntax-type">AppProps</span> {'{'}<br />
            {'  '}title: <span className="code-syntax-type">string</span>;<br />
            {'}'}<br />
            <br />
            <span className="code-syntax-keyword">export const</span> <span className="code-syntax-func">App</span>: React.<span className="code-syntax-type">FC</span>&lt;<span className="code-syntax-type">AppProps</span>&gt; = ({'{ title }'}) =&gt; {'{'}<br />
            {'  '}<span className="code-syntax-keyword">const</span> [greetMsg, setGreetMsg] = <span className="code-syntax-func">useState</span>(<span className="code-syntax-string">""</span>);<br />
            {'  '}<span className="code-syntax-keyword">const</span> [name, setName] = <span className="code-syntax-func">useState</span>(<span className="code-syntax-string">""</span>);<br />
            <br />
            {'  '}<span className="code-syntax-keyword">async function</span> <span className="code-syntax-func">greet</span>() {'{'}<br />
            {'    '}<span className="code-syntax-comment">// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command</span><br />
            {'    '}<span className="code-syntax-func">setGreetMsg</span>(<span className="code-syntax-keyword">await</span> <span className="code-syntax-func">invoke</span>(<span className="code-syntax-string">"greet"</span>, {'{ name }'}));<br />
            {'  '}{'}'}<br />
            <br />
            {'  '}<span className="code-syntax-func">useEffect</span>(() =&gt; {'{'}<br />
            {'    '}<span className="code-syntax-func">console</span>.<span className="code-syntax-func">log</span>(<span className="code-syntax-string">"Monolith Component Mounted"</span>);<br />
            {'  '}{'}, []);'}<br />
            <br />
            {'  '}<span className="code-syntax-keyword">return</span> (<br />
            {'    '}&lt;<span className="code-syntax-func">div</span> className=<span class="code-syntax-string">"container"</span>&gt;<br />
            {'      '}&lt;<span className="code-syntax-func">h1</span>&gt;{'{title}'}&lt;/<span className="code-syntax-func">h1</span>&gt;<br />
            {'    '}&lt;/<span className="code-syntax-func">div</span>&gt;<br />
            {'  '});<br />
            {'};'}
          </code>
        </pre>
      </div>
    </div>
  </main>
);

const Terminal = () => (
  <aside className="w-[400px] bg-surface-container flex flex-col border-l border-outline-variant/10">
    <div className="h-9 flex items-center px-4 justify-between border-b border-outline-variant/10">
      <div className="flex items-center gap-4 text-[11px] font-bold tracking-widest text-on-surface uppercase">
        <span className="border-b-2 border-primary-container pb-1">Terminal</span>
        <span className="text-on-surface-variant hover:text-on-surface cursor-pointer">Output</span>
        <span className="text-on-surface-variant hover:text-on-surface cursor-pointer">Debug Console</span>
      </div>
      <div className="flex items-center gap-2 text-on-surface-variant">
        <Plus className="w-4 h-4 cursor-pointer hover:text-on-surface" />
        <Trash2 className="w-4 h-4 cursor-pointer hover:text-on-surface" />
        <X className="w-4 h-4 cursor-pointer hover:text-on-surface" />
      </div>
    </div>
    <div className="flex-1 p-4 font-mono text-[13px] overflow-auto">
      <div className="flex gap-2 mb-1">
        <span className="text-green-400">➜</span>
        <span className="text-blue-400">monolith-project</span>
        <span className="text-on-surface">git:(<span className="text-red-400">main*</span>)</span>
        <span className="text-yellow-400">npm run dev</span>
      </div>
      <div className="text-on-surface-variant mb-2">&gt; monolith-project@0.1.0 dev</div>
      <div className="text-on-surface-variant mb-4">&gt; vite</div>
      <div className="flex flex-col gap-1">
        <div className="text-blue-400">VITE v6.2.0  ready in 421 ms</div>
        <div className="flex gap-2">
          <span className="text-on-surface-variant">➜</span>
          <span className="font-bold">Local:</span>
          <span className="text-blue-400 underline">http://localhost:3000/</span>
        </div>
        <div className="flex gap-2">
          <span className="text-on-surface-variant">➜</span>
          <span className="font-bold">Network:</span>
          <span className="text-on-surface-variant">use --host to expose</span>
        </div>
      </div>
      <div className="mt-4 text-green-500">✓ Compiled successfully.</div>
      <div className="mt-1 text-on-surface-variant">10:42:12 [vite] hmr update /src/index.ts</div>
      <div className="mt-4 flex animate-pulse">
        <div className="w-2 h-4 bg-on-surface-variant"></div>
      </div>
    </div>
  </aside>
);

const StatusBar = () => (
  <footer className="h-6 bg-primary-container text-white flex justify-between px-3 items-center text-[11px] font-semibold uppercase select-none">
    <div className="flex h-full items-center">
      <div className="px-3 flex items-center bg-white/10 hover:bg-white/20 cursor-pointer h-full gap-1">
        <GitBranch className="w-3.5 h-3.5" />
        main*
      </div>
      <div className="px-3 flex items-center hover:bg-white/10 cursor-pointer h-full gap-1">
        <RefreshCw className="w-3.5 h-3.5" />
      </div>
      <div className="px-3 flex items-center hover:bg-white/10 cursor-pointer h-full gap-3">
        <div className="flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />
          0
        </div>
        <div className="flex items-center gap-1">
          <TriangleAlert className="w-3.5 h-3.5" />
          2
        </div>
      </div>
    </div>
    <div className="flex h-full items-center">
      <div className="px-3 flex items-center hover:bg-white/10 cursor-pointer h-full">
        Ln 12, Col 42
      </div>
      <div className="px-3 flex items-center hover:bg-white/10 cursor-pointer h-full">
        Spaces: 2
      </div>
      <div className="px-3 flex items-center hover:bg-white/10 cursor-pointer h-full">
        UTF-8
      </div>
      <div className="px-3 flex items-center hover:bg-white/10 cursor-pointer h-full gap-1">
        <Code2 className="w-3.5 h-3.5" />
        TypeScript JSX
      </div>
      <div className="px-3 flex items-center hover:bg-white/10 cursor-pointer h-full">
        <Bell className="w-3.5 h-3.5" />
      </div>
    </div>
  </footer>
);

export default function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-surface text-on-surface font-sans overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <ActivityBar />
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TitleBar />
          <div className="flex-1 flex overflow-hidden">
            <Editor />
            <Terminal />
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
