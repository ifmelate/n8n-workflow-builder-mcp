import json
import os
import re
import uuid

def extract_value_from_js_object_str(obj_str, key):
    """
    Extracts a value for a given key from a string representation of a JS object.
    Handles string, number, boolean, and simple array/object default values.
    Very basic, relies on regex.
    """
    pattern = rf"""
        \b{key}\s*:\s*                           # Key followed by colon
        (?P<value>
            (?:true|false|null|undefined)        # Booleans, null, undefined
            |
            (?:\d+\.?\d*|\.\d+)                  # Numbers (integers, floats)
            |
            (?:
                '(?:\\.|[^'])*'                   # Single quoted strings
                |
                "(?:\\.|[^"])*"                  # Double quoted strings
            )
            |
            (?<![:"'\w])\[[\s\S]*?\](?![\w"']) # Arrays (non-greedy, careful with context)
            |
            (?<![:"'\w])\{{[\s\S]*?\}}(?![\w"']) # Objects (non-greedy, careful with context)
        )
    """
    match = re.search(pattern, obj_str, re.VERBOSE)
    if match:
        val_str = match.group("value").strip()
        if val_str.lower() == 'true': return True
        if val_str.lower() == 'false': return False
        if val_str.lower() == 'null' or val_str.lower() == 'undefined': return None
        if (val_str.startswith("'") and val_str.endswith("'")) or \
           (val_str.startswith('"') and val_str.endswith('"')):
            return val_str[1:-1].replace("\\'", "'").replace('\\"', '"')
        try:
            if val_str.replace('.', '', 1).isdigit() or val_str.startswith('[') or val_str.startswith('{'):
                 return json.loads(val_str)
        except json.JSONDecodeError:
            pass 
        return val_str
    return None

def extract_node_details_from_ts(ts_content):
    details = {
        'displayName': None,
        'name': None, 
        'version': 1,
        'descriptionText': None,
        'properties': [],
        'credentials_config': []
    }
    desc_block_match = re.search(r"description:\s*INodeTypeDescription\s*=\s*(\{[\s\S]*?\});", ts_content)
    if desc_block_match:
        desc_block_content = desc_block_match.group(1)
        details['name'] = extract_value_from_js_object_str(desc_block_content, 'name')
        details['displayName'] = extract_value_from_js_object_str(desc_block_content, 'displayName')
        details['version'] = extract_value_from_js_object_str(desc_block_content, 'version') or 1
        details['descriptionText'] = extract_value_from_js_object_str(desc_block_content, 'description')

    properties_block_match = re.search(r"\bproperties:\s*(?:INodeProperties(?:\x5B\x5D)?\s*=\s*)?(\[[\s\S]*?\]);", ts_content, re.MULTILINE)
    if properties_block_match:
        properties_block_str = properties_block_match.group(1)
        prop_matches = re.finditer(r"\{\s*([\s\S]*?)\s*\}\s*(?=,?\s*(?:\]|\{))", properties_block_str)
        for prop_match_outer in prop_matches:
            prop_content_str = prop_match_outer.group(1)
            prop_details = {}
            prop_details['displayName'] = extract_value_from_js_object_str(prop_content_str, 'displayName')
            prop_details['name'] = extract_value_from_js_object_str(prop_content_str, 'name')
            prop_details['type'] = extract_value_from_js_object_str(prop_content_str, 'type')
            prop_details['default'] = extract_value_from_js_object_str(prop_content_str, 'default')
            prop_details['description'] = extract_value_from_js_object_str(prop_content_str, 'description')
            prop_details['placeholder'] = extract_value_from_js_object_str(prop_content_str, 'placeholder')
            prop_details['required'] = extract_value_from_js_object_str(prop_content_str, 'required')

            if prop_details.get('type') in ['options', 'multiOptions']:
                options_array_match = re.search(r"\boptions:\s*(\[[\s\S]*?\])", prop_content_str, re.MULTILINE)
                if options_array_match:
                    options_array_str = options_array_match.group(1)
                    current_options = []
                    option_item_matches = re.finditer(r"\{\s*([\s\S]*?)\s*\}\s*(?=,?\s*\])", options_array_str)
                    for opt_item_match_outer in option_item_matches:
                        opt_content = opt_item_match_outer.group(1)
                        opt_name = extract_value_from_js_object_str(opt_content, 'name')
                        opt_value = extract_value_from_js_object_str(opt_content, 'value')
                        opt_desc = extract_value_from_js_object_str(opt_content, 'description')
                        if opt_name is not None and opt_value is not None:
                            option_entry = {'name': opt_name, 'value': opt_value}
                            if opt_desc is not None: option_entry['description'] = opt_desc
                            current_options.append(option_entry)
                    prop_details['options'] = current_options
            
            if prop_details.get('type') == 'collection':
                type_options_match = re.search(r"\btypeOptions:\s*(\{[\s\S]*?\})", prop_content_str)
                if type_options_match:
                    type_options_str = type_options_match.group(1)
                    if "multipleValues" in type_options_str: 
                         prop_details['typeOptions'] = { "multipleValues": True }
                    elif "fixedCollection" in type_options_str:
                        prop_details['typeOptions'] = { "fixedCollection": True, "description": "Fixed structure collection, details may not be fully parsed."}

            if prop_details.get('name'):
                details['properties'].append(prop_details)

    creds_match = re.search(r"\bcredentials:\s*(?:INodeCredential\x5B\x5D\s*=\s*)?(\[[\s\S]*?\]);", ts_content, re.MULTILINE)
    if creds_match:
        creds_str = creds_match.group(1)
        cred_item_matches = re.finditer(r"\{\s*([\s\S]*?)\s*\}\s*(?=,?\s*\])", creds_str)
        for cred_item_match_outer in cred_item_matches:
            cred_content = cred_item_match_outer.group(1)
            cred_name = extract_value_from_js_object_str(cred_content, 'name')
            cred_required = extract_value_from_js_object_str(cred_content, 'required')
            if cred_name:
                details['credentials_config'].append({'name': cred_name, 'required': bool(cred_required)})
    return details

def construct_node_definition_json(node_details, node_type_from_json_file, default_node_name_from_json):
    node_display_name = node_details.get('displayName') or default_node_name_from_json or "Unnamed Node"
    if not node_type_from_json_file:
        print(f"Warning: Missing 'type' for node '{node_display_name}'. Skipping JSON generation.")
        return None

    # Prepare parameters from properties, ensuring all details are included
    detailed_properties = []
    for prop in node_details.get('properties', []):
        param_detail = {
            'name': prop.get('name'),
            'displayName': prop.get('displayName'),
            'type': prop.get('type'),
            'default': prop.get('default'), # Retain original default for information
            'description': prop.get('description'),
            'placeholder': prop.get('placeholder'),
            'required': prop.get('required')
        }
        if 'options' in prop:
            param_detail['options'] = prop['options']
        if 'typeOptions' in prop:
            param_detail['typeOptions'] = prop['typeOptions']
        
        # Filter out None values for cleaner output, unless it's a meaningful None like default for non-string types
        # For simplicity, we'll keep them for now, front-end can filter if needed.
        detailed_properties.append({k: v for k, v in param_detail.items() if v is not None or k == 'default'})


    node_definition = {
        "nodeType": node_type_from_json_file,
        "displayName": node_display_name,
        "description": node_details.get('descriptionText', "No description available."),
        "version": node_details.get('version', 1),
        "properties": detailed_properties,
        "credentialsConfig": node_details.get('credentials_config', [])
    }
    return node_definition

def process_ts_file(ts_file_path, output_dir, processed_node_types):
    """Process a single .node.ts file and generate corresponding JSON if needed"""
    
    node_file_base = os.path.basename(ts_file_path).replace(".node.ts", "")
    node_dir_path = os.path.dirname(ts_file_path)
    json_file_path = os.path.join(node_dir_path, node_file_base + ".node.json")
    
    node_type_from_json, default_node_name_from_json = None, None
    if os.path.exists(json_file_path):
        try:
            with open(json_file_path, 'r', encoding='utf-8') as f_json:
                json_meta_data = json.load(f_json)
                node_type_from_json = json_meta_data.get('node')
                if json_meta_data.get('defaults'):
                    default_node_name_from_json = json_meta_data['defaults'].get('name')
        except Exception as e:
            print(f"Warning: Error reading {json_file_path}: {e}")
    
    if not node_type_from_json:
        return 0
    
    if node_type_from_json in processed_node_types:
        return 0
    processed_node_types.add(node_type_from_json)

    try:
        with open(ts_file_path, 'r', encoding='utf-8') as f_ts:
            ts_content = f_ts.read()
        node_details = extract_node_details_from_ts(ts_content)
        
        if not node_details.get('displayName') and default_node_name_from_json:
            node_details['displayName'] = default_node_name_from_json
        elif not node_details.get('displayName'):
            node_details['displayName'] = node_file_base.replace(".node","")

        node_definition_output = construct_node_definition_json(node_details, node_type_from_json, default_node_name_from_json)
        
        if node_definition_output:
            filename_base = node_type_from_json
            if filename_base.startswith("n8n-nodes-base."):
                safe_filename = filename_base.replace("n8n-nodes-base.", "") + ".json"
            else:
                safe_filename = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', node_type_from_json) + ".json"
            output_file_path = os.path.join(output_dir, safe_filename)
            with open(output_file_path, 'w', encoding='utf-8') as outfile:
                json.dump(node_definition_output, outfile, indent=2, ensure_ascii=False)
            return 1
    except Exception as e:
        print(f"Error processing {ts_file_path}: {e}")
        import traceback
        traceback.print_exc()
    
    return 0

def walk_node_directories(base_dir, output_dir, processed_node_types):
    """Recursively walk through node directories and process all .node.ts files"""
    nodes_processed = 0
    
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith(".node.ts"):
                ts_file_path = os.path.join(root, file)
                nodes_processed += process_ts_file(ts_file_path, output_dir, processed_node_types)
    
    return nodes_processed

def main():
    nodes_base_dir = "./packages/nodes-base/nodes"
    output_dir = "./workflow_nodes"
    
    if not os.path.exists(nodes_base_dir):
        print(f"Error: Source directory not found {nodes_base_dir}")
        return

    if os.path.exists(output_dir):
        # Clear existing files in output_dir if it exists
        for f in os.listdir(output_dir):
            os.remove(os.path.join(output_dir, f))
    else:
        os.makedirs(output_dir)
        print(f"Created output directory: {output_dir}")

    processed_node_types = set()
    
    # Use the new walk function to process all nodes recursively
    nodes_processed_count = walk_node_directories(nodes_base_dir, output_dir, processed_node_types)
    
    print(f"Processed and saved {nodes_processed_count} node workflow JSON files to {output_dir}")

if __name__ == '__main__':
    main()

