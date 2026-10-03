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
  codingLoad:(owner,slug)=>ipcRenderer.invoke('coding-load',owner,slug),
  codingSave:(owner,draft)=>ipcRenderer.invoke('coding-save',owner,draft),
  codingCheck:(owner,slug,main)=>ipcRenderer.invoke('coding-check',owner,slug,main),
  codingRun:(owner,payload)=>ipcRenderer.invoke('coding-run',owner,payload),
  codingSubmit:(owner,payload)=>ipcRenderer.invoke('coding-submit',owner,payload),
  codingPoll:(owner,id)=>ipcRenderer.invoke('coding-poll',owner,id),
  codingCancel:()=>ipcRenderer.invoke('coding-cancel'),
  codingCompiler:()=>ipcRenderer.invoke('coding-compiler'),
  codingChooseCompiler:()=>ipcRenderer.invoke('coding-choose-compiler'),
  codingCompilerGuide:()=>ipcRenderer.invoke('coding-compiler-guide'),
  onCodingProgress:callback=>ipcRenderer.on('coding-progress',(_event,progress)=>callback(progress))
});
