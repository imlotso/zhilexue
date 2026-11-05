#!/usr/bin/env python3
"""根据原始技能包生成智学课堂扩展包；不改写上游原包。"""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
source = root / 'data/mofang-question-transcribe.zip'
target = root / 'data/zhilexue-question-transcribe.zip'
overlay = root / 'data/zhilexue-transcribe'
prefix = 'mofang-question-transcribe/'

with ZipFile(source) as old, ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=9) as new:
    for info in old.infolist():
        data = old.read(info.filename)
        if info.filename == prefix + 'SKILL.md':
            text = data.decode('utf-8')
            original = '作答需要的共同条件要落实到每道受影响题的正式题干，或按 v1 协议把完整题组作为一条记录。'
            replacement = '智学课堂导入时，作答需要的共享材料可写入每道小题的 metadata.extra.zhilexue.material 并标注分组；其他宿主仍将共同条件落实到每道受影响题的正式题干，或按 v1 协议把完整题组作为一条记录。'
            if original not in text:
                raise SystemExit('原技能包的共享材料说明已变化，请重新核对')
            text = text.replace(original, replacement, 1)
            text += '\n## 智学课堂导入\n\n目标是智学课堂时，先阅读 [references/zhilexue.md](references/zhilexue.md)，使用该说明中的英语题型和共享材料扩展。缺答案、解析时仍须为 null；音频需由老师在待审核中上传。\n'
            data = text.encode('utf-8')
        elif info.filename == prefix + 'references/question-pack.schema.json':
            schema = json.loads(data)
            extra = schema['properties']['questions']['items']['properties']['metadata']['properties']['extra']
            extra['properties']['zhilexue'] = {
                'description': '智学课堂共享材料与题组扩展；其他宿主可忽略',
                'type': 'object', 'additionalProperties': False,
                'properties': {
                    'material': {'type': 'string', 'maxLength': 100000},
                    'group_ref': {'type': 'string', 'minLength': 1, 'maxLength': 100, 'pattern': '\\S'},
                    'group_position': {'type': 'integer', 'minimum': 1, 'maximum': 30},
                    'grade': {'type': 'string', 'maxLength': 30},
                    'difficulty_score_10': {'type': 'integer', 'minimum': 1, 'maximum': 10},
                },
                'dependentRequired': {'group_ref': ['group_position'], 'group_position': ['group_ref']}
            }
            data = (json.dumps(schema, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        new.writestr(info, data)
    new.writestr(prefix + 'references/zhilexue.md', (overlay / 'guide.md').read_bytes())
    new.writestr(prefix + 'assets/examples/zhilexue-english.json', (overlay / 'english-example.json').read_bytes())
print(target)
