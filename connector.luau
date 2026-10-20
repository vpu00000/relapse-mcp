local a={cache={}::any}do do local function __modImpl()return function(b,c)
local d=b.LogService

c:BindToType("execute",function(e)
task.defer(function()
setthreadidentity(8)
loadstring(e.source)()
end)
end)

c:BindToTypeRaw("get-console-output",function(e)
local f=math.max(1,math.min(tonumber(e.limit)or 20,200))
local g=e.logsOrder or"NewestFirst"
local h=e.filter
local i=typeof(h)=="string"and h~=""
local j=e.summaryOnly==true

local k=d:GetLogHistory()
local l={}
local m=0
local n={}

local function matchesFilter(o)
if not i then return true end
return string.find(o.message,h,1,true)~=nil
end

local o=500
local function formatLogMessage(p)
local q=tostring(p or"")
if#q>o then
q=string.sub(q,1,o)
.."…(+"..(#q-o).." chars omitted)"
end
return q
end

if g=="NewestFirst"then
for p=#k,1,-1 do
local q=k[p]
if not matchesFilter(q)then continue end

m+=1
local r=q.messageType and q.messageType.Name or"Unknown"
n[r]=(n[r]or 0)+1
if#l<f then
table.insert(l,q)
end
end
else
for p,q in k do
if not matchesFilter(q)then continue end

m+=1
local r=q.messageType and q.messageType.Name or"Unknown"
n[r]=(n[r]or 0)+1
if#l<f then
table.insert(l,q)
end
end
end

local p={}
if j then
table.insert(p,string.format("Matched %d logs.",m))
for q,r in n do
table.insert(p,string.format("%s: %d",q,r))
end
return table.concat(p,"\n")
end

table.insert(p,string.format("Displaying %d/%d logs:",#l,m))

for q,r in l do
table.insert(p,string.format(
"[%s t=%s] %s",
r.messageType.Name,tostring(r.timestamp),
formatLogMessage(r.message)
))
end

return table.concat(p,"\n")
end)

c:BindToType("get-data-by-code",function(e)
setthreadidentity(8)
local f=table.pack(loadstring(e.source)())

return f
end)
end end function a.a():typeof(__modImpl())local b=a.cache.a if not b then b={c=__modImpl()}a.cache.a=b end return b.c end end do local function __modImpl()

return function(b,c)
c:BindToTypeRaw("get-script-content",function(d)
local e
if d.debugId then
e=b.GetScriptByDebugId(d.debugId)
assert(e,"No live script instance found for DebugId: "..tostring(d.debugId))
else
setthreadidentity(8)
e=loadstring(d.source)()
assert(typeof(e)=="Instance","Script instance is not an instance.")
assert(e:IsA"LuaSourceContainer","Script instance is not a LuaSourceContainer.")
assert(not(e:IsA"Script"and e.RunContext~=Enum.RunContext.Client),
"Script instance is server-only.")
end
local f=b.DecompileScriptSource(e)
assert(f,"Failed to decompile script.")
local g=string.split(f,"\n")
local h=#g
local i=math.max(1,math.min(tonumber(d.maxLines)or 80,2000))
local j=math.max(1,math.min(tonumber(d.startLine)or 1,h))
local k=math.max(j,math.min(tonumber(d.endLine)or h,h))
local l=math.min(k,j+i-1)
local m={}
for n=j,l do m[#m+1]=g[n]end
local n=if l<k then
"\n-- Output truncated to "..i.." lines. Rerun with startLine="..(l+1).."."
else""
return"-- Lines "..j.."-"..l.." of "..h.."\n"..
table.concat(m,"\n")..n
end)
end end function a.b():typeof(__modImpl())local b=a.cache.b if not b then b={c=__modImpl()}a.cache.b=b end return b.c end end do local function __modImpl()

return function(b,c)
local d=b.MarketplaceService
local e=b.RobloxReplicatedStorage

c:BindToType("search-instances",function(f)
local g=loadstring("return "..f.root)()
local h=g:QueryDescendants(f.selector)

local i=math.max(1,math.min(tonumber(f.limit)or 20,100))
local j={}

for k,l in h do
if k>i then break end

local m=l.Name
pcall(function()m=l:GetFullName()end)

table.insert(j,{
Name=l.Name,
ClassName=l.ClassName,
Path=m,
DebugId=l:GetDebugId()
})
end

return{
count=#h,
limited=#h>i,
results=j
}
end)

c:BindToType("get-game-info",function(f)
local g=d:GetProductInfo(game.PlaceId)

local h={
PlaceId=game.PlaceId,
GameId=game.GameId,
PlaceVersion=game.PlaceVersion,
PlaceName=g.Name,
Creator=g.Creator.Name,
CreatorType=tostring(g.Creator.CreatorType),
CreatorId=g.Creator.CreatorTargetId,
JobId=game.JobId,
ServerType=e.GetServerType:InvokeServer()
}



if f.includeDescription==true then
h.PlaceDescription=g.Description
end

return h
end)

c:BindToType("get-descendants-tree",function(f)
local g=loadstring("return "..f.root)()
assert(typeof(g)=="Instance","Root path did not resolve to a valid Instance.")

local h=math.max(0,math.min(tonumber(f.maxDepth)or 2,5))
local i=math.max(1,math.min(tonumber(f.maxChildren)or 20,30))
local j=f.classFilter or""
local k=j~=""
local l=f.summaryOnly==true
local m=300
local n=m
local o=false

if l then
local p={}
local q=0
local r=0

local function walk(s,t)
if t>h then
return
end

for u,v in s:GetChildren()do
q+=1
if not k or v:IsA(j)then
r+=1
p[v.ClassName]=(p[v.ClassName]or 0)+1
end
if t<h then
walk(v,t+1)
end
end
end

walk(g,1)

return{
Root={
Name=g.Name,
ClassName=g.ClassName,
ChildCount=#g:GetChildren(),
},
MaxDepth=h,
ClassFilter=if k then j else nil,
VisitedDescendants=q,
MatchedDescendants=r,
ClassCounts=p,
}
end

local function buildTree(p,q)
if q>h then
return nil
end

local r=p:GetChildren()
local s={}
local t=0
local u=#r

for v,w in r do
if t>=i then break end
if n<=0 then
o=true
break
end

if k and not w:IsA(j)then


if q<h then
local x=buildTree(w,q+1)
if x and x.Children and#x.Children>0 then
table.insert(s,x)
t+=1
end
end
continue
end

n-=1

local x={
Name=w.Name,
ClassName=w.ClassName,
ChildCount=#w:GetChildren()
}

if q<h and x.ChildCount>0 then
local y=buildTree(w,q+1)
if y then
x.Children=y.Children
end
end

table.insert(s,x)
t+=1
end

return{
Name=p.Name,
ClassName=p.ClassName,
ChildCount=u,
TruncatedAt=if t<u then t else nil,
Children=s
}
end

local p=buildTree(g,0)
if o and typeof(p)=="table"then
p.Note="Output capped at "..m.." nodes. Narrow with classFilter, lower maxDepth, or summaryOnly=true."
end
return p
end)
end end function a.c():typeof(__modImpl())local b=a.cache.c if not b then b={c=__modImpl()}a.cache.c=b end return b.c end end do local function __modImpl()

return function(b,c)
c:BindToType("ensure-remote-spy",function(d)
if getgenv().Cobalt then
return{
status="already_loaded",
message="Cobalt remote spy is already running."
}
end


local e,f=pcall(function()
loadstring(game:HttpGet"https://gitlab.com/upio/cobalt/-/releases/permalink/latest/downloads/Cobalt.luau")()
end)

if not e then
error("Failed to load Cobalt: "..tostring(f))
end


local g=os.clock()
while not getgenv().Cobalt and os.clock()-g<10 do
task.wait(0.1)
end

assert(getgenv().Cobalt,"Cobalt loaded but failed to initialize within 10 seconds.")

return{
status="loaded",
message="Cobalt remote spy loaded successfully."
}
end)

c:BindToType("get-remote-spy-logs",function(d)
local e=getgenv().Cobalt
assert(e and e.shared and e.shared.Logs,"Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

local f=d.direction or"Both"
local g=d.remoteNameFilter or""
local h=math.max(1,math.min(tonumber(d.limit)or 10,100))
local i=math.max(0,math.min(tonumber(d.maxCallsPerRemote)or 2,20))
local j=d.summaryOnly==true
local k=g~=""

local function ProcessLogs(l,m)
local n={}

for o,p in l do
local q=p.Instance
if typeof(q)~="Instance"then continue end
if#n>=h then break end

local r=""
local s=""
pcall(function()
r=q.Name
s=q.ClassName
end)


if k and not string.find(string.lower(r),string.lower(g),1,true)then
continue
end


local t={}
local u=#p.Calls
local v=math.max(1,u-i+1)

if not j then
for w=v,u do
local x=p.Calls[w]
if not x then continue end

table.insert(t,{
Index=w,
Arguments=x.Arguments,
Origin=x.Origin,
IsExecutor=x.IsExecutor or false,
IsActor=x.IsActor or false,
Line=x.Line,
})
end
end

table.insert(n,{
RemoteName=r,
RemoteClass=s,
Direction=m,
Method=p.Method
or(((e.shared.FunctionForClasses or{})[m])or{})[s],
TotalCalls=u,
Ignored=p.Ignored,
Blocked=p.Blocked,
RecentCalls=if j then nil else t,
})
end

return n
end

local l={}

if f=="Outgoing"or f=="Both"then
local m=ProcessLogs(e.shared.Logs.Outgoing,"Outgoing")
for n,o in m do
table.insert(l,o)
end
end

if f=="Incoming"or f=="Both"then
local m=ProcessLogs(e.shared.Logs.Incoming,"Incoming")
for n,o in m do
table.insert(l,o)
end
end


table.sort(l,function(m,n)
return m.TotalCalls>n.TotalCalls
end)


if#l>h then
local m={}
for n=1,h do
m[n]=l[n]
end
l=m
end

return{
count=#l,
results=l
}
end)
end end function a.d():typeof(__modImpl())local b=a.cache.d if not b then b={c=__modImpl()}a.cache.d=b end return b.c end end do local function __modImpl()

return function(b,c)
c:BindToType("clear-remote-spy-logs",function(d)
local e=getgenv().Cobalt
assert(e and e.shared and e.shared.ClearLogs,"Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

e.shared.ClearLogs()

return{
status="cleared",
message="All remote spy logs have been cleared."
}
end)

c:BindToType("block-remote",function(d)
local e=getgenv().Cobalt
assert(e and e.shared and e.shared.Logs,"Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

local f=d.remoteName
local g=d.direction
local h=d.shouldBlock

local i=e.shared.Logs[g]
assert(i,"Invalid direction: "..tostring(g))

for j,k in i do
local l=k.Instance
if typeof(l)~="Instance"then continue end

local m=""
pcall(function()m=l.Name end)

if m==f then
if h and not k.Blocked then
k:Block()
elseif not h and k.Blocked then
k:Block()
end

return{
status="success",
message=(h and"Blocked"or"Unblocked").." remote: "..f,
blocked=k.Blocked
}
end
end

error("Remote not found: "..f.." in "..g.." logs. Make sure the remote has been logged at least once.")
end)

c:BindToType("ignore-remote",function(d)
local e=getgenv().Cobalt
assert(e and e.shared and e.shared.Logs,"Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

local f=d.remoteName
local g=d.direction
local h=d.shouldIgnore

local i=e.shared.Logs[g]
assert(i,"Invalid direction: "..tostring(g))

for j,k in i do
local l=k.Instance
if typeof(l)~="Instance"then continue end

local m=""
pcall(function()m=l.Name end)

if m==f then
if h and not k.Ignored then
k:Ignore()
elseif not h and k.Ignored then
k:Ignore()
end

return{
status="success",
message=(h and"Ignoring"or"Unignored").." remote: "..f,
ignored=k.Ignored
}
end
end

error("Remote not found: "..f.." in "..g.." logs. Make sure the remote has been logged at least once.")
end)




c:BindToType("remote-spy",function(d)
c.Callbacks["ensure-remote-spy"]{}

local e=d.operation
if e=="status"then
local f=getgenv().Cobalt
local function CountLogs(g)
local h=0
if typeof(g)~="table"then return h end
for i in g do
h+=1
end
return h
end

return{
status="loaded",
outgoingRemotes=CountLogs(f.shared and f.shared.Logs and f.shared.Logs.Outgoing),
incomingRemotes=CountLogs(f.shared and f.shared.Logs and f.shared.Logs.Incoming),
}
elseif e=="list"then
return c.Callbacks["get-remote-spy-logs"]{
direction=d.direction,
remoteNameFilter=d.nameFilter,
limit=d.limit,
maxCallsPerRemote=d.maxCallsPerRemote,
summaryOnly=d.summaryOnly,
}
elseif e=="clear"then
return c.Callbacks["clear-remote-spy-logs"]{}
elseif e=="block"or e=="unblock"then
return c.Callbacks["block-remote"]{
remoteName=d.remoteName,
direction=d.direction,
shouldBlock=e=="block",
}
elseif e=="ignore"or e=="unignore"then
return c.Callbacks["ignore-remote"]{
remoteName=d.remoteName,
direction=d.direction,
shouldIgnore=e=="ignore",
}
end

error("Invalid remote-spy operation: "..tostring(e))
end)
end end function a.e():typeof(__modImpl())local b=a.cache.e if not b then b={c=__modImpl()}a.cache.e=b end return b.c end end do local function __modImpl()

return function(b,c)
local d=b.VirtualInputManager

c:BindToType("type-text-box",function(e)
local f=e.path
local g=e.string or e.text
local h=e.enter
local i=e.useKeyPress

local j
if typeof(f)=="string"then
j=loadstring("return "..f)()
else
j=f
end

assert(typeof(j)=="Instance","Path did not resolve to a valid Instance.")
assert(j:IsA"TextBox","Resolved Instance is not a TextBox.")

j:CaptureFocus()
task.wait(0.05)

if i then
local k=pcall(function()
for k=1,#g do
d:SendTextInput(g:sub(k,k),nil,game)
task.wait(0.01)
end
end)

if not k and type(keypress)=="function"then
for l=1,#g do
local m=g:sub(l,l):upper()
local n=m:byte()
if n then
keypress(n)
task.wait(0.01)
if type(keyrelease)=="function"then
keyrelease(n)
end
end
end
end
else
j.Text=g
end

if h then
if i then
if type(keypress)=="function"then
keypress(0x0D)
task.wait(0.01)
if type(keyrelease)=="function"then
keyrelease(0x0D)
end
else
pcall(function()
d:SendKeyEvent(true,Enum.KeyCode.Return,false,game)
task.wait(0.01)
d:SendKeyEvent(false,Enum.KeyCode.Return,false,game)
end)
end
end
j:ReleaseFocus(true)
else
j:ReleaseFocus(false)
end

return{
status="success",
message="Successfully typed into TextBox."
}
end)

c:BindToType("click-button",function(e)
local f=e.path
local g=e.Action or e.action

local h
if typeof(f)=="string"then
h=loadstring("return "..f)()
else
h=f
end

assert(typeof(h)=="Instance","Path did not resolve to a valid Instance.")
assert(h:IsA"GuiButton","Resolved Instance is not a GuiButton (e.g., TextButton or ImageButton).")
assert(typeof(firesignal)=="function","Your executor does not support 'firesignal', which is required for this command.")

local i={"Activated","MouseButton1Down","MouseButton2Down","MouseButton1Click","MouseButton2Click"}

if g then
assert(table.find(i,g),"Invalid action provided. Valid actions are: "..table.concat(i,", "))
firesignal(h[g])
else
for j,k in pairs(i)do
pcall(function()firesignal(h[k])end)
end
end

return{
status="success",
message="Successfully fired click signals on Button."
}
end)
end end function a.f():typeof(__modImpl())local b=a.cache.f if not b then b={c=__modImpl()}a.cache.f=b end return b.c end end end

local b=__relapse_mcp_channel
if not game:IsLoaded()then game.Loaded:Wait()end
local c=getgenv()
local d="__relapse_mcp_"..b
local e=c[d]
if e and e.publish then
e.publish()
return
end

local f=cloneref or function(f)return f end
local g=f(game:GetService"HttpService")
local h=f(game:GetService"LogService")
local i=f(game:GetService"Players")
local j=f(game:GetService"MarketplaceService")
local k=f(game:GetService"RobloxReplicatedStorage")
local l=f(game:GetService"CoreGui")
local m=f(game:GetService"CorePackages")
local n=f(game:GetService"ScriptContext")
local o=f(Instance.new"VirtualInputManager")

local function sanitize(p,q,r)
local s=typeof(p)
if s=="Instance"then
local t,u=pcall(function()return p:GetFullName()end)
return t and u or tostring(p)
end
if s=="string"then
if#p>500 then return p:sub(1,500).."… [truncated]"end
return p
end
if s=="number"or s=="boolean"or s=="nil"then return p end
if s~="table"then return tostring(p)end
if q>=8 then return"<max depth>"end
if r[p]then return"<cycle>"end
r[p]=true
local t={}
local u=0
for v,w in p do
u+=1
if u>60 then t.__omitted="more entries omitted"break end
local x=if type(v)=="string"or type(v)=="number"then v else tostring(v)
t[x]=sanitize(w,q+1,r)
end
r[p]=nil
return t
end

local function serialize(p,q,r)
local s=type(p)
if s=="string"then return string.format("%q",p)end
if s=="number"or s=="boolean"then return tostring(p)end
if s=="nil"then return"nil"end
if s~="table"then return string.format("%q",tostring(p))end
if q>=8 or r[p]then return"{...}"end
r[p]=true
local t={}
local u=0
local v=1
for w,x in p do
u+=1
if u>60 then t[#t+1]="..."break end
local y="["..serialize(w,q+1,r).."] = "
if w==v then
y=""
v+=1
end
t[#t+1]=y..serialize(x,q+1,r)
end
r[p]=nil
return"{"..table.concat(t,", ").."}"
end

local p={channel=nil,peers={},scripts={},scanGeneration=0,
mappingSessionId="",mappingStartedAt=0,revision=0,
descendantAdded=nil,descendantRemoving=nil,rescanScheduled=false}
local q={Callbacks={},RawCallbacks={}}
function q.BindToType(r,s,t)r.Callbacks[s]=t end
function q.BindToTypeRaw(r,s,t)
r.Callbacks[s]=t
r.RawCallbacks[s]=true
end
function q.Send(r,s)
for t in p.peers do
if t.Connected then pcall(t.Send,t,s)else p.peers[t]=nil end
end
end
function q.HandleMessage(r,s,t)
if type(s)~="table"or type(s.type)~="string"or type(s.id)~="string"then return end
local u=r.Callbacks[s.type]
if not u then
t:Send{id=s.id,error="Unknown command: "..s.type}
return
end
task.spawn(function()
local v,w=pcall(u,s)
if not t.Connected then return end
if not v then
pcall(t.Send,t,{id=s.id,error=tostring(w)})
elseif w~=nil then
local x
if r.RawCallbacks[s.type]then
x=tostring(w)
else
local y=sanitize(w,0,{})
if type(y)~="table"then y={y}end
x=serialize(y,0,{})
end
if#x>7340032 then
pcall(t.Send,t,{id=s.id,
error="Result exceeds the Relapse channel limit. Request a smaller range or result."})
else
pcall(t.Send,t,{id=s.id,output=x})
end
end
end)
end

local function isScript(r)
return r:IsA"LuaSourceContainer"and
(not r:IsA"Script"or r.RunContext==Enum.RunContext.Client)and
not r.RobloxLocked and not r:IsDescendantOf(l)and
not r:IsDescendantOf(m)and not r:IsDescendantOf(n)
end
local function readSource(r)
local s,t=pcall(decompile,r)
if s and type(t)=="string"and#t>0 then return t end
return nil
end
local function emitSources(r,s,t,u,v)
p.revision+=1
q:Send{type="script-sources",scripts=r,
hasFinishedMapping=s,sourcesToMap=t,
processedSources=u,skippedSources=v,
mappingSessionId=p.mappingSessionId,
mappingSessionStartedAt=p.mappingStartedAt,
mappingRevision=p.revision,
beginMappingSession=p.revision==1}
end
local function scanScripts(r)
p.scripts={}
p.mappingSessionId=g:GenerateGUID(false)
p.mappingStartedAt=math.max(os.time()*1000,p.mappingStartedAt+1)
p.revision=0
local s=game:QueryDescendants"LuaSourceContainer"
if type(getnilinstances)=="function"then
local t,u=pcall(getnilinstances)
if t and type(u)=="table"then
for v,w in u do s[#s+1]=w end
end
end
local t,u={},{}
for v,w in s do
local x,y=pcall(isScript,w)
if x and y and not u[w]then
u[w]=true
t[#t+1]=w
end
end
local v,w,x=#t,0,0
local y,z={},0
emitSources({},false,v,w,x)
for A,B in t do
task.wait()
if r~=p.scanGeneration or not next(p.peers)then return end
local C,D=pcall(function()return B:GetDebugId()end)
local E=readSource(B)
if r~=p.scanGeneration or not next(p.peers)then return end
if C and E then
p.scripts[D]=B
local F,G=pcall(function()return B:GetFullName()end)
if not F then G=tostring(B)end
local H=#E+#G+#D+256
if H>7340032 then
x+=1
else
if z+H>524288 or#y>=16 then
emitSources(y,false,v,w,x)
y,z={},0
end
y[#y+1]={debugId=D,path=G,source=E}
z+=H
end
else
x+=1
end
w+=1
end
if r==p.scanGeneration and next(p.peers)then
emitSources(y,true,v,w,x)
end
end

local function startScan()
p.scanGeneration+=1
local r=p.scanGeneration
task.spawn(function()
setthreadidentity(8)
local s,t=pcall(scanScripts,r)
if not s then warn("Relapse MCP script scan failed: "..tostring(t))end
end)
end

local function scheduleRescan(r)
local s,t=pcall(isScript,r)
if not s or not t or p.rescanScheduled or not next(p.peers)then return end
p.rescanScheduled=true
task.delay(0.5,function()
p.rescanScheduled=false
if next(p.peers)then startScan()end
end)
end

local r={
LogService=h,
MarketplaceService=j,
RobloxReplicatedStorage=k,
VirtualInputManager=o,
GetScriptByDebugId=function(r)return p.scripts[r]end,
DecompileScriptSource=function(r)return readSource(r)end,
}
for s,t in{a.a()
,a.b()
,a.c()
,a.d()
,a.e()
,a.f()
,
}do t(r,q)end

function p.publish()
if p.channel and p.channel.IsPublished then return end
local s=RelapseChannel.new(b)
p.channel=s
if not p.descendantAdded then
p.descendantAdded=game.DescendantAdded:Connect(scheduleRescan)
p.descendantRemoving=game.DescendantRemoving:Connect(scheduleRescan)
end
s.Connected:Connect(function(t)
p.peers[t]=true
t.Disconnected:Connect(function()
p.peers[t]=nil
if not next(p.peers)and p.channel==s then
p.scanGeneration+=1
p.scripts={}
s:Close()
p.descendantAdded:Disconnect()
p.descendantRemoving:Disconnect()
p.descendantAdded=nil
p.descendantRemoving=nil
if c[d]==p then c[d]=nil end
end
end)
t.MessageReceived:Connect(function(u)q:HandleMessage(u,t)end)
local u=i.LocalPlayer
local v="Unknown"
pcall(function()v=j:GetProductInfo(game.PlaceId).Name end)
t:Send{type="hello",client={
username=u and u.Name or"Unknown",
userId=u and u.UserId or 0,
placeId=game.PlaceId,
jobId=game.JobId,
placeName=v,
}}
startScan()
end)
end

c[d]=p
p.publish()