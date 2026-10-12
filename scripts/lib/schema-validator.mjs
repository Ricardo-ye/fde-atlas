/**
 * ������ JSON Schema У������draft 2020-12 �Ӽ�����
 *
 * Ϊʲô���� ajv��
 *   ������Ŀд�� data/case.schema.json����û���κνű����������Ѻ�ʵ��
 *   ȫ�ֿ�ֻ�� schema ������ $schema/$id ���к� README �ᵽ������
 *   ������У�����ȫ����д�� build-data.mjs ������Ѿ�Ư�� ����
 *   schema �� detail_dimensions ������ additionalProperties ��ֵԼ����
 *   ��дУ����ȴֻ�ȶԸ��ֶε��ַ������л�����Ƿ���������һ�¡�
 *
 *   ����Ŀ�� schema ��ΪΨһ��ʵ��validator ����Χ�� schema д�ģ�
 *   ������򣨿��ֶ�һ���ԡ�˫����롢�ظ����ݣ����� rule �㡣
 *
 * ֧�ֵĹؼ��֣�
 *   type / required / properties / additionalProperties / enum / const
 *   pattern / minLength / maxLength / minimum / maximum / exclusiveMinimum
 *   items / minItems / maxItems / uniqueItems
 *   $ref����֧�� #/$defs/xxx ���ֱ���ָ�룩�� $defs
 *
 * ��ȷ��֧�֣�����ʱ�״����Ǿ�Ĭ�Ź�����
 *   oneOf/anyOf/allOf/not/if-then-else��$dynamicRef��format ���ԡ�Զ�� $ref��
 *   У����"©��"��"����"Σ�յö࣬���Բ�֧�ֵ�д��һ������ʧ�ܡ�
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

/** ���� `#/$defs/name` ��ʽ�ı��� JSON Pointer�� */
const resolveRef = (root, ref) => {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    // Զ�� $ref / ���ַ��� $ref һ�ɾܾ������ܼ��ؾ͵���У�鲻�ˣ�
    // ��"У�鲻��ȴ����ͨ��"����Σ�յ�ʧ��ģʽ��
    throw new Error(`��֧�ֵ� $ref����֧�ֱ��� #/ ָ�룩��${JSON.stringify(ref)}`);
  }
  let node = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === undefined || node === null || !(segment in node)) {
      throw new Error(`$ref �޷�������${ref}`);
    }
    node = node[segment];
  }
  return node;
};

export class SchemaValidator {
  constructor(schema) {
    if (!schema || typeof schema !== 'object') throw new Error('schema �����Ƕ���');
    this.schema = schema;
    this.#assertSupported(schema, '#');
  }

  /** Ԥ�죺schema �����δʵ�ֵĹؼ��ֻ�֧�ֵ� $ref ʱֱ���״�������"��װУ��ͨ��"�� */
  #assertSupported(schema, pointer) {
    if (!schema || typeof schema !== 'object') return;
    for (const key of UNSUPPORTED) {
      if (key in schema) {
        throw new Error(`schema ${pointer} ʹ����δ֧�ֵĹؼ��� "${key}"������չУ�������д schema`);
      }
    }
    // $ref �������ڹ����ھ��ж����ã����������Ƴٵ�"ǡ���������ߵ��Ǹ���֧"
    // �ű�¶����ʱ�����Ѿ������ͨ�����档
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
   * @returns {string[]} ����·���б����������ʾͨ����
   */
  validate(data, { rootSchema = this.schema, basePath = '$' } = {}) {
    const errors = [];
    this.#validateNode(data, rootSchema, basePath, errors);
    return errors;
  }

  #validateNode(data, schema, pointer, errors) {
    if (schema === true || schema === undefined) return;
    if (schema === false) {
      errors.push(`${pointer}: ��λ�ò���������ֵ`);
      return;
    }

    if (schema.$ref) {
      // draft 2020-12 ���� $ref ��ͬ���ؼ��ֲ��棬������ﲻ�� return ����
      // ���� `{ "$ref": "...", "additionalProperties": false }` ���
      // additionalProperties �ᱻ��Ĭ���������"��ԶУ��ͨ��"��
      this.#validateNode(data, resolveRef(this.schema, schema.$ref), pointer, errors);
    }

    if (schema.type !== undefined) {
      const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!expected.some((type) => matchesType(data, type))) {
        errors.push(`${pointer}: ����ӦΪ ${expected.join(' | ')}��ʵ��Ϊ ${typeOf(data)}`);
        return; // �����Ѵ��������ؼ���ֻ���������
      }
    }

    if (schema.enum !== undefined && !schema.enum.some((option) => deepEqual(option, data))) {
      errors.push(`${pointer}: ������ ${schema.enum.map((v) => JSON.stringify(v)).join(' / ')} ֮һ��ʵ��Ϊ ${JSON.stringify(data)}`);
    }

    if (schema.const !== undefined && !deepEqual(schema.const, data)) {
      errors.push(`${pointer}: ������� ${JSON.stringify(schema.const)}`);
    }

    if (typeof data === 'string') this.#validateString(data, schema, pointer, errors);
    if (typeof data === 'number') this.#validateNumber(data, schema, pointer, errors);
    if (Array.isArray(data)) this.#validateArray(data, schema, pointer, errors);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      this.#validateObject(data, schema, pointer, errors);
    }
  }

  #validateString(data, schema, pointer, errors) {
    // �� [...data] �������������� emoji / ��Ƨ�ֱ���������ַ�
    const length = [...data].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push(`${pointer}: ������Ҫ ${schema.minLength} ���ַ���ʵ�� ${length}`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push(`${pointer}: ��� ${schema.maxLength} ���ַ���ʵ�� ${length}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) {
      errors.push(`${pointer}: ��ƥ���ʽ ${schema.pattern}`);
    }
  }

  #validateNumber(data, schema, pointer, errors) {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${pointer}: ����С�� ${schema.minimum}��ʵ�� ${data}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${pointer}: ���ܴ��� ${schema.maximum}��ʵ�� ${data}`);
    }
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      errors.push(`${pointer}: ������� ${schema.exclusiveMinimum}��ʵ�� ${data}`);
    }
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) {
      errors.push(`${pointer}: ����С�� ${schema.exclusiveMaximum}��ʵ�� ${data}`);
    }
  }

  #validateArray(data, schema, pointer, errors) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`${pointer}: ������Ҫ ${schema.minItems} �ʵ�� ${data.length} ��`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(`${pointer}: ��� ${schema.maxItems} �ʵ�� ${data.length} ��`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      data.forEach((item, index) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${pointer}[${index}]: ��ǰ�����Ŀ�ظ�`);
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
        errors.push(`${pointer}: ȱ�ٱ����ֶ� "${field}"`);
      }
    }
    for (const [key, value] of Object.entries(data)) {
      const childPointer = `${pointer}.${key}`;
      if (schema.properties && key in schema.properties) {
        this.#validateNode(value, schema.properties[key], childPointer, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPointer}: �������Ķ����ֶ�`);
      } else if (typeof schema.additionalProperties === 'object') {
        this.#validateNode(value, schema.additionalProperties, childPointer, errors);
      }
    }
  }
}

/** �����ڣ�һ����У���������飬����ǰ׺���ϵڼ�����¼�� */
export const validateRecords = (validator, records, { idOf = (r) => r.id } = {}) =>
  records.flatMap((record, index) =>
    validator.validate(record, { basePath: `#${index + 1} ${idOf(record) || '(�� id)'}` }),
  );