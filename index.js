require("dotenv").config();
const OpenAI = require("openai");
const fs = require("fs");

const openai = new OpenAI();



async function main(){

    const salesAssistantName = "Node4 Sales Assistant";

    let assistant = null;

    // https://platform.openai.com/docs/assistants/tools/file-search?lang=node.js

    console.log("Trying to find assistant", salesAssistantName);
    const myAssistants = await openai.beta.assistants.list({
        order: "desc",
        limit: "20",
    });
    console.log("myAssistants", myAssistants);
    assistant = myAssistants.data.find((e) => e.name === salesAssistantName);
    if (!assistant) {
        console.log("Could not find assistant", salesAssistantName, 'Creating one...');
        assistant = await openai.beta.assistants.create({
            name: salesAssistantName,
            instructions: "You are an expert Sales Assistant of the company Node4. Use you knowledge base to propose a solution including the technologies needed.",
            model: "gpt-4o-mini",
            tools: [{ type: "file_search" }],
        });

        console.log(`Created assistant ${assistant.id}`);
    }

    console.log(`Using assistant ${assistant.id}`);

    console.log("assistant", assistant);

    const fileStreams = ["./CaseStudies.md"].map((path) =>
        fs.createReadStream(path),
    );

    let vectorStore = null;
    const vectorStoreName = "sales-assistant-vector";
    try {
        console.log(`Trying to find Vector Store name=${vectorStoreName}`);
        let vectorStores = await openai.beta.vectorStores.list({
            order: "desc",
            limit: "20",
        });

        vectorStore = vectorStores.data.find(e => e.name === vectorStoreName);

        console.log(`Found Vector Store with name=vectorStoreName  id=${vectorStore.id}`);
        console.log("vectorStore retrieve", vectorStore);

        let error = new Error(`Could not find vector store with name= ${vectorStoreName}`);
        error.status = 404;
    } catch (e) {
        if (e.status !== 404) {
            console.error(e);
            return;
        }
    }

    if (!vectorStore) {
        console.log(`Vector Store with name ${vectorStoreName} not found. Creating it...`);
        // Create a vector store including our two files.
        vectorStore = await openai.beta.vectorStores.create({
            name: vectorStoreName,
            expires_after: {
                anchor: "last_active_at",
                days: 1
            }
        });
        console.log(`Vector Store "${vectorStoreName}" ID=${vectorStore.id} has been created`);
    }
    console.log(`Using Vector Store "${vectorStoreName}" ID=${vectorStore.id}`);
    console.log("vectorStore", vectorStore);

    const caseStudiesFileId = fs.readFileSync('caseStudiesId.txt', {encoding: 'utf-8'});
    let vectorStoreFile = null;
    try {
        if (caseStudiesFileId.trim() === '') {
            let error = new Error('caseStudiesFileId not populated.');
            error.status = 404;
            throw error;
        }
        console.log(`Trying to find Vector File ${caseStudiesFileId} of Vector Store ${vectorStore.id}`);
        vectorStoreFile = await openai.beta.vectorStores.files.retrieve(
            vectorStore.id,
            caseStudiesFileId,
        );
        
    } catch (e) {
        if (e.status !== 404) {
            console.error(e);
            return;
        }
    }

    if (!vectorStoreFile) {

        
        
        console.log(`Vector File ${caseStudiesFileId} of Vector Store ${vectorStore.id} not found. Creating it...`);

        const file = await openai.files.create({
            file: fileStreams[0],
            purpose: "assistants",
        });

        console.log("File", file);

        fs.writeFileSync('./caseStudiesId.txt', file.id);
        vectorStoreFile = await openai.beta.vectorStores.files.create(vectorStore.id, {
            file_id: file.id,
        });
        console.log(vectorStoreFile);
        console.log(`Vector File ${caseStudiesFileId} of Vector Store ${vectorStore.id} has been created`);
    }

    console.log(`Using Vector file ${vectorStoreFile.id}`, vectorStoreFile);

    await openai.beta.assistants.update(assistant.id, {
    tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
    });

    const inputQuery = fs.readFileSync("./input.txt", "utf-8");

    const thread = await openai.beta.threads.create({
        messages: [
            {
            role: "user",
            content: inputQuery,
            },
        ],
    });

    console.log("initiating stream");
    const stream = openai.beta.threads.runs
    .stream(thread.id, {
        assistant_id: assistant.id,
    })
    .on("textCreated", () => console.log("assistant >"))
    .on("toolCallCreated", (event) => console.log("assistant " + event.type))
    .on("messageDone", async (event) => {
        if (event.content[0].type === "text") {
            const { text } = event.content[0];
            const { annotations } = text;
            const citations = [];

            let index = 0;
            for (let annotation of annotations) {
                text.value = text.value.replace(annotation.text, "[" + index + "]");
                const { file_citation } = annotation;
                if (file_citation) {
                const citedFile = await openai.files.retrieve(file_citation.file_id);
                citations.push("[" + index + "]" + citedFile.filename);
                }
                index++;
            }


            let allText = text.value + citations.join("\n");

            //console.log(text.value);
            //console.log(citations.join("\n"));

            console.log(allText);

            fs.writeFileSync("output.md", allText);

            

            
        }
    });
    /*
    for await (const event of stream) {
        console.log(event);
    }
    */



}

main()
.then(() => {
    console.log("supposedlu done");
})
.catch((err) => {
    console.error(err);
})