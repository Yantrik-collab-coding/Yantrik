import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// xterm CSS — only active in Electron Desktop; harmless in browser
import 'xterm/css/xterm.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
