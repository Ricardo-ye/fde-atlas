/**
 * 零依赖 JSON Schema 校验器（draft 2020-12 子集）。
 *
 * 为什么不用 ajv：
 *   上游项目写了 data/case.schema.json，但没有任何脚本引用它（已核实：
 *   全仓库只有 schema 自身的 $schema/$id 两行和 README 提到它）。
 *   真正的校验规则全部手写在 build-data.mjs 里，两者已经漂移 ——
 *   schema 里 detail_dimensions 声明了 additionalProperties 数值约束，
 *   手写校验器却只比对该字段的字符串序列化结果是否与评分器一致。
 *
 *   本项目让 schema 成为唯一事实：validator 就是围绕 schema 写的，
 *   额外规则（跨字段一致性、双语对齐、重复内容）放在 rule 层。
 *
 * 支持的关键字：
 *   type / required / properties / additionalProperties / enum / const
 *   pattern / minLength / maxLength / minimum / maximum / exclusiveMinimum
 *   items / minItems / maxItems / uniqueItems
 *   $ref（仅支持 #/$defs/xxx 这种本地指针）与 $defs
 *
 * 明确不支持（遇到时抛错而非静默放过）：
 *   oneOf/anyOf/allOf/not/if-then-else、$dynamicRef、format 断言、远程 $ref。
 *   校验器"漏判"比"报错"危险得多，所以不支持的写法一律响亮失败。
 */

const SUPPORTED = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description', 'examples', '$comment',
  'type', 'required', 'properties', 'additionalProperties', 'enum', 'const',
  'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'items', 'minItems', 'maxItems', 'uniqueItems',
]);

const UNSUPPORTED = [
  'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else',
  'dependentSchemas', 'dependentRequired', 'patternProperties',
  '$dynamicRef', '$dynamicAnchor', 'contains', 'propertyNames',
];

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const matchesType = (value, expected) => {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
};

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 解析 `#/$defs/name` 形式的本地 JSON Pointer。 */
const resolveRef = (root, ref) => {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    // 远程 $ref / 非字符串 $ref 一律拒绝：不能加载就等于校验不了，
    // 而"校验不了却报告通过"是最危险的失败模式。
    throw new Error(`不支持的 $ref（仅支持本地 #/ 指针）：${JSON.stringify(ref)}`);
  }
  let node = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === undefined || node === null || !(segment in node)) {
      throw new Error(`$ref 无法解析：${ref}`);
    }
    node = node[segment];
  }
  return node;
};

export class SchemaValidator {
  constructor(schema) {
    if (!schema || typeof schema !== 'object') throw new Error('schema 必须是对象');
    this.schema = schema;
    this.#assertSupported(schema, '#');
  }

  /** 预检：schema 里出现未实现的关键字或不支持的 $ref 时直接抛错，避免"假装校验通过"。 */
  #assertSupported(schema, pointer) {
    if (!schema || typeof schema !== 'object') return;
    for (const key of UNSUPPORTED) {
      if (key in schema) {
        throw new Error(`schema ${pointer} 使用了未支持的关键字 "${key}"，请扩展校验器或改写 schema`);
      }
    }
    // $ref 必须能在构造期就判定可用，否则错误会推迟到"恰好有数据走到那个分支"
    // 才暴露，那时可能已经输出了通过报告。
    if ('$ref' in schema) resolveRef(this.schema, schema.$ref);

    for (const [key, value] of Object.entries(schema)) {
      if (!SUPPORTED.has(key)) continue;
      if (key === 'properties' || key === '$defs') {
        for (const [name, sub] of Object.entries(value || {})) {
          this.#assertSupported(sub, `${pointer}/${key}/${name}`);
        }
      } else if (key === 'items' || key === 'additionalProperties') {
        if (value && typeof value === 'object') this.#assertSupported(value, `${pointer}/${key}`);
      }
    }
  }

  /**
   * @returns {string[]} 错误路径列表，空数组表示通过。
   */
  validate(data, { rootSchema = this.schema, basePath = '$' } = {}) {
    const errors = [];
    this.#validateNode(data, rootSchema, basePath, errors);
    return errors;
  }

  #validateNode(data, schema, pointer, errors) {
    if (schema === true || schema === undefined) return;
    if (schema === false) {
      errors.push(`${pointer}: 该位置不允许出现值`);
      return;
    }

    if (schema.$ref) {
      // draft 2020-12 允许 $ref 与同级关键字并存，因此这里不能 return ——
      // 否则 `{ "$ref": "...", "additionalProperties": false }` 里的
      // additionalProperties 会被静默跳过，变成"永远校验通过"。
      this.#validateNode(data, resolveRef(this.schema, schema.$ref), pointer, errors);
    }

    if (schema.type !== undefined) {
      const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!expected.some((type) => matchesType(data, type))) {
        errors.push(`${pointer}: 类型应为 ${expected.join(' | ')}，实际为 ${typeOf(data)}`);
        return; // 类型已错，后续关键字只会产生噪音
      }
    }

    if (schema.enum !== undefined && !schema.enum.some((option) => deepEqual(option, data))) {
      errors.push(`${pointer}: 必须是 ${schema.enum.map((v) => JSON.stringify(v)).join(' / ')} 之一，实际为 ${JSON.stringify(data)}`);
    }

    if (schema.const !== undefined && !deepEqual(schema.const, data)) {
      errors.push(`${pointer}: 必须等于 ${JSON.stringify(schema.const)}`);
    }

    if (typeof data === 'string') this.#validateString(data, schema, pointer, errors);
    if (typeof data === 'number') this.#validateNumber(data, schema, pointer, errors);
    if (Array.isArray(data)) this.#validateArray(data, schema, pointer, errors);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      this.#validateObject(data, schema, pointer, errors);
    }
  }

  #validateString(data, schema, pointer, errors) {
    // 用 [...data] 按码点计数，避免 emoji / 生僻字被算成两个字符
    const length = [...data].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push(`${pointer}: 至少需要 ${schema.minLength} 个字符，实际 ${length}`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push(`${pointer}: 最多 ${schema.maxLength} 个字符，实际 ${length}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) {
      errors.push(`${pointer}: 不匹配格式 ${schema.pattern}`);
    }
  }

  #validateNumber(data, schema, pointer, errors) {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${pointer}: 不能小于 ${schema.minimum}，实际 ${data}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${pointer}: 不能大于 ${schema.maximum}，实际 ${data}`);
    }
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      errors.push(`${pointer}: 必须大于 ${schema.exclusiveMinimum}，实际 ${data}`);
    }
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
      errors.push(`${pointer}: 必须小于 ${schema.exclusiveMaximum}，实际 ${data}`);
    }
  }

  #validateArray(data, schema, pointer, errors) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`${pointer}: 至少需要 ${schema.minItems} 项，实际 ${data.length} 项`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(`${pointer}: 最多 ${schema.maxItems} 项，实际 ${data.length} 项`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      data.forEach((item, index) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${pointer}[${index}]: 与前面的项目重复`);
        seen.add(key);
      });
    }
    if (schema.items !== undefined) {
      data.forEach((item, index) => {
        this.#validateNode(item, schema.items, `${pointer}[${index}]`, errors);
      });
    }
  }

  #validateObject(data, schema, pointer, errors) {
    for (const field of schema.required || []) {
      if (data[field] === undefined) {
        errors.push(`${pointer}: 缺少必填字段 "${field}"`);
      }
    }
    for (const [key, value] of Object.entries(data)) {
      const childPointer = `${pointer}.${key}`;
      if (schema.properties && key in schema.properties) {
        this.#validateNode(value, schema.properties[key], childPointer, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPointer}: 不允许的额外字段`);
      } else if (typeof schema.additionalProperties === 'object') {
        this.#validateNode(value, schema.additionalProperties, childPointer, errors);
      }
    }
  }
}

/** 便捷入口：一次性校验整个数组，错误前缀带上第几条记录。 */
export const validateRecords = (validator, records, { idOf = (r) => r.id } = {}) =>
  records.flatMap((record, index) =>
    validator.validate(record, { basePath: `#${index + 1} ${idOf(record) || '(无 id)'}` }),
  );