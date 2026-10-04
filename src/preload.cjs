const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('leettrack', {
  getState:()=>ipcRenderer.invoke('get-state'),
  login:()=>ipcRenderer.invoke('login'),
  sync:history=>ipcRenderer.invoke('sync',history),
  pauseHistory:()=>ipcRenderer.invoke('pause-history'),
  refresh:()=>ipcRenderer.invoke('refresh'),
  rateReview:(account,id,rating)=>ipcRenderer.invoke('rate-review',account,id,rating),
  openProblem:slug=>ipcRenderer.invoke('open-problem',slug),
  openSubmission:id=>ipcRenderer.invoke('open-submission',id),
  export:()=>ipcRenderer.invoke('export'),
  onState:callback=>ipcRenderer.on('state',(_event,state)=>callback(state)),
  codingLoad:(owner,slug,language)=>ipcRenderer.invoke('coding-load',owner,slug,language),
  codingSave:(owner,draft)=>ipcRenderer.invoke('coding-save',owner,draft),
  codingCheck:(owner,slug,main,language)=>ipcRenderer.invoke('coding-check',owner,slug,main,language),
  codingRun:(owner,payload)=>ipcRenderer.invoke('coding-run',owner,payload),
  codingSubmit:(owner,payload)=>ipcRenderer.invoke('coding-submit',owner,payload),
  codingPoll:(owner,id)=>ipcRenderer.invoke('coding-poll',owner,id),
  codingCancel:()=>ipcRenderer.invoke('coding-cancel'),
  codingCompiler:language=>ipcRenderer.invoke('coding-compiler',language),
  codingChooseCompiler:language=>ipcRenderer.invoke('coding-choose-compiler',language),
  codingCompilerGuide:language=>ipcRenderer.invoke('coding-compiler-guide',language),
  onCodingProgress:callback=>ipcRenderer.on('coding-progress',(_event,progress)=>callback(progress))
});
