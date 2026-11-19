// js/jarvis/brains_75.js
// 75 specialised cognitive reasoning modes for JARVIS. Zero imports.
// Each brain emulates the working style of a tool category as a prompt-level
// reasoning workflow; it does not call the tool's own API.

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// [name, category, keywords, strength, workflow steps separated by "|"]
const RAW = [
  ["Codex", "coding-agent", "codex,refactor,patch,pull request,repo,implement", "Reads a repository, plans a minimal patch and verifies it with tests.", "Map the repo and entry points|State the smallest change that satisfies the task|Write the patch with tests|Run checks mentally and list failure modes|Summarise the diff and risks"],
  ["Claude Code", "coding-agent", "claude code,terminal,agentic coding,multi-file,cli,debug", "Agentic terminal coder that explores, edits many files and iterates on errors.", "Explore files and conventions first|Plan edits in order of dependency|Edit incrementally and re-check each step|Reproduce and fix errors from output|Report what changed and how to verify"],
  ["Cursor", "ide", "cursor,ide,autocomplete,inline edit,composer,codebase chat", "IDE pair-programmer for inline edits and codebase-aware completion.", "Gather the surrounding code context|Propose an inline edit in the file's style|Check imports, types and call sites|Offer a follow-up refactor if it helps"],
  ["Google Antigravity", "ide", "antigravity,agent manager,browser agent,artifacts,agent-first ide", "Agent-first IDE where several agents plan, code and verify in a browser.", "Split the task into agent-sized missions|Assign plan, build and verify roles|Produce artifacts (plan, diff, test evidence)|Cross-check results and merge"],
  ["Obsidian", "knowledge", "obsidian,notes,vault,zettelkasten,backlinks,markdown notes", "Builds linked notes and a personal knowledge graph in Markdown.", "Extract atomic ideas|Name notes by concept|Link related notes with backlinks|Add tags and a map-of-content note|Surface open questions"],
  ["Hugging Face", "ml-framework", "hugging face,transformers,model hub,datasets,tokenizer,fine-tune", "Finds models and datasets and wires them with Transformers.", "Define task and metric|Shortlist hub models by licence and size|Plan data prep and tokenisation|Sketch fine-tune or inference code|Evaluate and document the model card"],
  ["PyTorch", "ml-framework", "pytorch,tensor,training loop,gpu,autograd,neural network", "Designs and debugs deep learning training code.", "Define data, model, loss and optimiser|Write the training loop with device handling|Check shapes, gradients and learning rate|Add validation and checkpoints|Profile speed and memory"],
  ["ComfyUI", "image-workflow", "comfyui,node graph,stable diffusion workflow,lora,controlnet,sampler", "Node-graph image generation pipelines.", "Choose checkpoint and resolution|Lay out loader, prompt, sampler and decode nodes|Add LoRA or ControlNet only where needed|Tune seed, steps and CFG|Save the workflow for reuse"],
  ["Gemini", "general-assistant", "gemini,multimodal,long context,google,video understanding", "Multimodal long-context reasoning across text, image, audio and video.", "Identify every modality in the input|Reason across modalities|Use the long context to cross-reference details|Answer with evidence from the source"],
  ["Perplexity", "search-research", "perplexity,cited answer,web search,sources,fact check,current events", "Answers with citations from live web sources.", "Break the question into searchable parts|Gather several independent sources|Compare and flag conflicts|Answer concisely with source attribution"],
  ["Claude", "general-assistant", "claude,writing,analysis,careful reasoning,long document,nuance", "Careful long-form reasoning, writing and analysis.", "Restate the real problem|Reason step by step with assumptions stated|Draft, then critique and revise|Give a clear answer with caveats"],
  ["Manus", "autonomous-agent", "manus,autonomous,general agent,task completion,deliverable", "General autonomous agent that plans and completes multi-step tasks.", "Define the end deliverable|Plan the tool and step sequence|Execute with checkpoints|Verify output against the goal|Deliver and summarise"],
  ["Genspark", "search-research", "genspark,super agent,sparkpage,research page,compare", "Builds synthesized research pages from many sources.", "Define the topic and sub-questions|Collect sources for each sub-question|Synthesise into a structured page|Add comparison and recommendation"],
  ["Claude Cowork", "autonomous-agent", "cowork,desktop agent,files,knowledge work,documents,spreadsheet", "Desktop knowledge-work agent that handles files and documents.", "Inspect the files and folders involved|Plan the document or data changes|Execute and save outputs|Review for errors before handing back"],
  ["ChatGPT", "general-assistant", "chatgpt,gpt,openai,brainstorm,custom gpt,general help", "Versatile conversational assistant for drafting and brainstorming.", "Clarify the goal and audience|Generate options|Refine the best option|Format for immediate use"],
  ["Grok", "general-assistant", "grok,xai,real-time,trends,x posts,witty", "Real-time, candid answers with awareness of current discussion.", "Check what is currently being discussed|State the direct answer|Flag uncertainty and rumours|Add a brief, candid take"],
  ["DeepSeek", "open-model", "deepseek,reasoning,chain of thought,math,cost efficient,r1", "Deep step-by-step reasoning on math and code at low cost.", "Decompose the problem|Reason through each step explicitly|Verify intermediate results|State the final answer and the check"],
  ["Microsoft Copilot", "general-assistant", "microsoft copilot,office,word,excel,outlook,teams,m365", "Assistant for Office documents, email and meetings.", "Identify the Office artifact involved|Draft or transform the content|Respect template and tone|Offer formulas, summaries or action items"],
  ["Meta AI", "general-assistant", "meta ai,whatsapp,instagram,social,everyday assistant", "Everyday quick assistant for social and messaging contexts.", "Keep it short and conversational|Answer directly|Offer a quick follow-up action"],
  ["Le Chat", "general-assistant", "le chat,mistral,european,fast answers,canvas", "Fast, privacy-aware assistant with canvas editing.", "Answer concisely|Use a canvas for longer drafts|Iterate on edits|Confirm sources when needed"],
  ["GitHub Copilot", "ide", "github copilot,pull request,code review,suggestions,workspace,actions", "In-editor suggestions and GitHub-native workflows.", "Read nearby code and tests|Suggest the next logical code|Check it against the repo's style|Prepare a PR description"],
  ["Devin", "autonomous-agent", "devin,software engineer agent,ticket,long task,sandbox", "Autonomous software engineer for scoped tickets.", "Read the ticket and acceptance criteria|Plan and set up the environment|Implement and run tests|Fix failures and open a PR|Report status and blockers"],
  ["Windsurf", "ide", "windsurf,cascade,flow,agentic ide,codeium", "Agentic IDE that keeps context across edits.", "Capture intent and context|Cascade multi-file edits|Run and fix|Keep a changelog of the session"],
  ["Replit Agent", "app-builder", "replit,agent,deploy,build app,prototype,hosted", "Builds and deploys apps from a prompt in the cloud.", "Turn the idea into requirements|Scaffold the app|Implement features in order|Test in the live preview|Deploy and share"],
  ["Lovable", "app-builder", "lovable,full-stack,supabase,react app,saas mvp", "Builds full-stack web apps from natural language.", "Define pages, data and users|Generate UI and backend|Connect auth and database|Iterate on design|Publish"],
  ["Bolt.new", "app-builder", "bolt,stackblitz,browser,web app,quick prototype", "Browser-based instant full-stack prototyping.", "Choose a minimal stack|Scaffold in the browser|Add features in small prompts|Preview and fix|Export or deploy"],
  ["v0", "app-builder", "v0,vercel,ui components,tailwind,shadcn,next.js", "Generates polished React UI components.", "Describe layout and states|Generate components with Tailwind|Check accessibility and responsiveness|Integrate into the app"],
  ["Amazon Q Developer", "ide", "amazon q,aws,lambda,cloudformation,migration,cdk", "AWS-aware coding and cloud migration help.", "Identify AWS services involved|Generate code or IaC|Check IAM and security|Suggest cost and upgrade paths"],
  ["Gemini Code Assist", "ide", "gemini code assist,google cloud,gcp,firebase,enterprise code", "Google Cloud-aware code completion and review.", "Read the codebase context|Generate or review code|Check for GCP best practices|Explain trade-offs"],
  ["OpenCode", "coding-agent", "opencode,open source agent,terminal agent,provider agnostic", "Open-source terminal coding agent that works with any model provider.", "Pick the provider and model|Explore the repo|Plan and edit|Run tests|Summarise"],
  ["NotebookLM", "knowledge", "notebooklm,source grounded,audio overview,study guide,notebook", "Answers only from the sources you provide.", "Load the sources|Answer strictly from them with references|Flag what the sources do not say|Generate summaries, guides or FAQs"],
  ["Elicit", "search-research", "elicit,literature review,papers,systematic review,extract data", "Finds papers and extracts structured findings.", "Define the research question|Search and screen papers|Extract study details into a table|Synthesise and note limits"],
  ["Consensus", "search-research", "consensus,scientific evidence,yes no,studies,claims", "Answers questions from peer-reviewed evidence.", "Turn the question into a testable claim|Find relevant studies|Weigh quality and agreement|State the evidence-based conclusion"],
  ["SciSpace", "search-research", "scispace,research paper,explain paper,pdf chat,citations", "Reads and explains scientific papers.", "Read the paper structure|Explain methods and results in plain language|Highlight limitations|Link related work"],
  ["Julius AI", "data", "julius,data analysis,csv,charts,statistics,regression", "Data analysis and visualisation from spreadsheets.", "Inspect and clean the data|Choose the right analysis|Run and chart it|Interpret and state caveats"],
  ["You.com", "search-research", "you.com,smart search,multi-model,research mode,apps", "Multi-source search that combines models and apps.", "Search several sources|Pick the best model for each part|Merge answers|Cite sources"],
  ["Phind", "search-research", "phind,developer search,programming answers,stack,docs", "Developer-focused search with code answers.", "Parse the technical question|Find docs and examples|Write a working code answer|Note version differences"],
  ["Tavily", "web-data", "tavily,search api,rag,agent search,web context", "Search API for agents that returns clean, relevant context.", "Form focused queries|Fetch and rank results|Extract relevant passages|Feed them to reasoning with URLs"],
  ["Exa", "web-data", "exa,neural search,semantic web search,find similar,embeddings", "Meaning-based web search.", "Describe the target in natural language|Run semantic search|Find similar pages|Filter by date and domain"],
  ["Firecrawl", "web-data", "firecrawl,scrape,crawl,website to markdown,extract structured", "Turns websites into clean Markdown or structured data.", "Define pages and schema|Crawl and scrape respecting robots rules|Clean the output|Validate extracted fields"],
  ["Midjourney", "image-gen", "midjourney,artistic image,aesthetic,style,concept art,prompt parameters", "Highly aesthetic artistic images.", "Define subject, mood, style and composition|Add lighting and camera terms|Set aspect ratio and stylise values|Iterate with variations"],
  ["FLUX", "image-gen", "flux,black forest labs,photoreal,text in image,open weights", "Photoreal images with strong prompt adherence.", "Write a descriptive natural-language prompt|Specify text content exactly|Choose model variant|Refine by editing the prompt"],
  ["Adobe Firefly", "image-gen", "firefly,adobe,commercially safe,generative fill,photoshop", "Commercially safe generative images integrated with Adobe tools.", "Clarify the use case and brand|Generate or fill|Match style references|Check licensing"],
  ["Ideogram", "image-gen", "ideogram,typography,logo,poster,text rendering", "Image generation with strong text rendering.", "Provide exact text and placement|Choose design style|Generate options|Refine typography"],
  ["Runway", "video-gen", "runway,gen-3,video editing,motion,camera control,gen-4", "Generative video with camera and motion control.", "Write the shot description|Set camera movement|Choose a reference image|Generate and trim|Edit in sequence"],
  ["Google Veo", "video-gen", "veo,google video,cinematic,audio video,text to video", "Cinematic text-to-video with native audio.", "Storyboard shots|Describe scene, action and sound|Generate clips|Check continuity"],
  ["Kling AI", "video-gen", "kling,image to video,motion,character animation,long clip", "Image-to-video and character motion.", "Choose a start frame|Describe motion|Control duration|Review physical plausibility"],
  ["ElevenLabs", "audio", "elevenlabs,text to speech,voice cloning,dubbing,narration,tts", "Natural voice generation and dubbing.", "Select voice and language|Prepare script with pronunciation hints|Generate and listen|Adjust pace and emphasis"],
  ["Sora", "video-gen", "sora,openai video,storyboard,realistic video,remix", "Realistic video from text with storyboard control.", "Write a clear scene prompt|Set shot length|Generate|Remix or refine"],
  ["Llama", "open-model", "llama,meta open model,fine-tuning,self host,open weights", "Open-weight general model for self-hosting and fine-tuning.", "Pick model size for hardware|Prompt with the right template|Fine-tune if needed|Evaluate"],
  ["Qwen", "open-model", "qwen,alibaba,multilingual,chinese,coder,vision language", "Multilingual open models with strong coding and vision variants.", "Pick the right Qwen variant|Handle multilingual input|Reason and answer|Verify in target language"],
  ["Gemma", "open-model", "gemma,google open,small model,on device,lightweight", "Lightweight open models for on-device use.", "Fit the model to device limits|Keep prompts short|Quantise where needed|Test quality"],
  ["Phi", "open-model", "phi,microsoft small model,slm,edge,reasoning small", "Small language models with strong reasoning for edge use.", "Define a narrow task|Use structured prompts|Run locally|Check accuracy"],
  ["Cohere Command", "open-model", "cohere,command,rag,enterprise,rerank,embed", "Enterprise RAG and retrieval models.", "Chunk and embed documents|Retrieve and rerank|Generate grounded answer|Cite passages"],
  ["IBM Granite", "open-model", "granite,ibm,enterprise,governance,code,open licence", "Enterprise-governed open models.", "Check licence and governance|Pick the right Granite model|Run on-premise|Audit output"],
  ["Amazon Nova", "open-model", "nova,amazon,bedrock,multimodal,cost,aws model", "AWS Bedrock models for cost-efficient multimodal tasks.", "Pick Nova tier|Call through Bedrock|Handle text and image|Monitor cost"],
  ["Mistral AI", "open-model", "mistral,mixtral,codestral,efficient,french,function calling", "Efficient models with strong function calling.", "Choose model by task|Define tools and schemas|Call and validate|Handle errors"],
  ["Ollama", "local-runtime", "ollama,local llm,run locally,modelfile,offline,pull model", "Run models locally with one command.", "Pick a model that fits RAM/VRAM|Pull and run|Write a Modelfile|Test through the local API"],
  ["LM Studio", "local-runtime", "lm studio,desktop,gguf,local server,openai compatible", "Desktop app for local GGUF models and a local API.", "Choose GGUF quantisation|Load and tune settings|Start the local server|Connect clients"],
  ["vLLM", "local-runtime", "vllm,serving,throughput,paged attention,batching,gpu inference", "High-throughput LLM serving.", "Size the GPU memory|Configure batching and context|Launch the server|Benchmark and tune"],
  ["LangChain", "orchestration", "langchain,chains,rag pipeline,tools,retriever,prompt template", "Compose LLM chains, tools and retrieval.", "Define inputs and outputs|Build prompt and retriever|Connect tools|Add tracing and evaluation"],
  ["LangGraph", "orchestration", "langgraph,stateful agent,graph,human in the loop,cycles", "Stateful multi-step agent graphs with loops and human checkpoints.", "Model state and nodes|Define edges and conditions|Add checkpoints and human approval|Test paths"],
  ["CrewAI", "orchestration", "crewai,multi-agent,roles,crew,tasks,delegation", "Role-based teams of cooperating agents.", "Define roles and goals|Assign tasks and tools|Set process (sequential or hierarchical)|Review outputs"],
  ["AutoGen", "orchestration", "autogen,multi-agent chat,conversation,code executor,group chat", "Conversational multi-agent collaboration.", "Create agents with roles|Set conversation rules|Run with code execution sandbox|Terminate on success"],
  ["n8n", "automation", "n8n,workflow automation,self hosted,webhook,nodes,ai agent node", "Self-hosted visual automation and AI workflows.", "Define trigger and goal|Map nodes and data flow|Handle errors and retries|Test with sample data|Activate"],
  ["Zapier", "automation", "zapier,zap,no-code,app integration,triggers,actions", "No-code app-to-app automation.", "Pick trigger app|Define actions|Add filters and paths|Test and turn on"],
  ["Make", "automation", "make,integromat,scenario,modules,routers,visual automation", "Visual scenario automation with routers and iterators.", "Draw the scenario|Map fields between modules|Add routers and error handlers|Run and schedule"],
  ["Open WebUI", "ui", "open webui,chat interface,self hosted,rag,ollama ui,multi user", "Self-hosted chat interface for local or API models.", "Connect model backends|Configure users and roles|Add knowledge collections|Set prompts and tools"],
  ["Aider", "coding-agent", "aider,git,pair programming,terminal,commits,repo map", "Git-native terminal pair programmer that commits each change.", "Build a repo map|Add only relevant files|Edit with clear diffs|Commit with messages|Run tests"],
  ["Cline", "coding-agent", "cline,vscode agent,approve,plan act,mcp,autonomous editing", "VS Code agent with plan and act modes and step approval.", "Plan first and show the plan|Ask approval for each action|Act and observe results|Adjust"],
  ["Kilo Code", "coding-agent", "kilo code,vscode,orchestrator,modes,open source agent", "Multi-mode coding agent with architect, code and debug modes.", "Pick architect, code or debug mode|Work the task in that mode|Switch modes as needed|Summarise"],
  ["OpenHands", "autonomous-agent", "openhands,open devin,sandbox,software agent,issues,swe-bench", "Open-source autonomous developer agent in a sandbox.", "Read the issue|Set up the sandbox|Edit, run and test|Iterate until tests pass|Submit change"],
  ["Amazon Kiro", "ide", "kiro,spec driven,requirements,design doc,tasks,hooks", "Spec-driven development: requirements, design, then tasks.", "Write requirements as user stories|Write a design document|Break into tasks|Implement task by task with hooks"],
  ["JetBrains Junie", "ide", "junie,jetbrains,intellij,pycharm,agent,refactoring", "JetBrains IDE agent that uses project inspections.", "Read the project structure|Plan the change|Edit with IDE inspections|Run tests and fix|Summarise"],
  ["Gamma", "ui", "gamma,presentation,slides,deck,pitch,document design", "Turns outlines into designed decks and documents.", "Define audience and message|Outline slides|Generate and design|Edit text and visuals|Export"]
];

const GUARDRAILS = [
  "State assumptions and what is unknown before concluding.",
  "Prefer verifiable facts; label guesses as guesses.",
  "Never claim to have run code, searches or tools you did not actually run.",
  "For safety-critical content (fire, PPE, machinery) defer to the current standard or a competent person."
];

const BRAINS = RAW.map(([name, category, kw, strength, steps], i) => {
  const workflow = steps.split("|");
  return Object.freeze({
    id: slug(name),
    index: i + 1,
    name,
    category,
    keywords: Object.freeze(kw.split(",").map((s) => s.trim())),
    strength,
    workflow: Object.freeze(workflow),
    guardrails: GUARDRAILS,
    systemPrompt: [
      `Mode: ${name} (${category}).`,
      strength,
      "Workflow:",
      ...workflow.map((s, n) => `${n + 1}. ${s}`),
    ].join("\n"),
  });
});

if (BRAINS.length !== 75) throw new Error(`BRAINS_75 must contain 75 brains, found ${BRAINS.length}`);

export const BRAINS_75 = Object.freeze(Object.fromEntries(BRAINS.map((b) => [b.id, b])));

const normalize = (s) => String(s || "").toLowerCase();

function scoreBrain(brain, q) {
  let score = 0;
  if (q.includes(brain.name.toLowerCase())) score += 10;
  for (const k of brain.keywords) if (q.includes(k)) score += k.includes(" ") ? 3 : 2;
  if (q.includes(brain.category.replace(/-/g, " "))) score += 1;
  return score;
}

/** Return the best matching brain. Falls back to Claude (general reasoning). */
export function selectBrainForTask(userQuery, topN = 1) {
  const q = normalize(userQuery);
  const ranked = BRAINS.map((b) => ({ b, s: scoreBrain(b, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.b.index - b.b.index);
  if (!ranked.length) return topN > 1 ? [BRAINS_75.claude] : BRAINS_75.claude;
  return topN > 1 ? ranked.slice(0, topN).map((x) => x.b) : ranked[0].b;
}

/** Compose one prompt from the user's task and one or more brains (ids or objects). */
export function buildMultiBrainPrompt(userQuery, activeBrains) {
  const list = (Array.isArray(activeBrains) ? activeBrains : [activeBrains])
    .map((x) => (typeof x === "string" ? BRAINS_75[x] || BRAINS_75[slug(x)] : x))
    .filter(Boolean);
  const brains = list.length ? list : [selectBrainForTask(userQuery)];
  const blocks = brains.map((b) => b.systemPrompt).join("\n\n---\n\n");
  return [
    "You are JARVIS. Think, plan, execute and verify independently using the reasoning modes below.",
    "",
    blocks,
    "",
    "Rules:",
    ...GUARDRAILS.map((g) => `- ${g}`),
    brains.length > 1 ? "- Merge the modes: plan once, then apply each mode's checks, and resolve conflicts explicitly." : "",
    "",
    `Task: ${String(userQuery || "").trim()}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export function listBrainsSummary() {
  return BRAINS.map((b) => ({ id: b.id, index: b.index, name: b.name, category: b.category, summary: b.strength }));
}

export default BRAINS_75;
