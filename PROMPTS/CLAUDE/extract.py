import json

# Define your input and output files
input_file = 'CLAUDE.jsonl'
output_file = 'claude_transcript.md'

with open(input_file, 'r', encoding='utf-8') as f_in, open(output_file, 'w', encoding='utf-8') as f_out:
    f_out.write("# Claude Chat Transcript\n\n")
    
    for line in f_in:
        try:
            # Parse each JSON line
            data = json.loads(line)
            
            # Extract role and content
            role = data.get('role', 'Unknown').capitalize()
            content = data.get('content', '')
            
            # Claude's API often formats content as a list of text blocks
            if isinstance(content, list):
                text_content = "\n".join([block.get('text', '') for block in content if block.get('type') == 'text'])
            else:
                text_content = str(content)
            
            # Write to Markdown file if there is actual text
            if text_content.strip():
                f_out.write(f"### {role}\n\n{text_content}\n\n---\n\n")
                
        except json.JSONDecodeError:
            continue

print(f"Extraction complete! Clean transcript saved to {output_file}")