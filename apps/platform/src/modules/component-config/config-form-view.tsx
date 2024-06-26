import { Form, Button, Space, Alert } from 'antd';
// import { debounce } from 'lodash';
import type { FormInstance } from 'antd/lib';
import { parse } from 'query-string';
import { useEffect, useState } from 'react';
import { useLocation } from 'umi';

import { ProjectEditService } from '@/modules/layout/header-project-list/project-edit.service';
import { useModel } from '@/util/valtio-helper';

import { DefaultComponentInterpreterService } from '../component-interpreter/component-interpreter-service';
import type {
  AtomicParameter,
  Attribute,
  ComputeMode,
  ValueOf,
} from '../component-tree/component-protocol';

import type {
  AtomicConfigNode,
  ConfigItem,
  CustomConfigNode,
  GraphNodeDetail,
  NodeDef,
  StructConfigNode,
} from './component-config-protocol';
import {
  getInputTables,
  getUpstreamKey,
  codeNameRenderIndex,
  codeNameRenderKey,
  advancedConfigIndex,
  hideCodeNameIndex,
} from './component-config-protocol';
import { ComponentConfigRegistry } from './component-config-registry';
import { DefaultComponentConfigService } from './component-config-service';
import type { NodeAllInfo } from './config-item-render/config-render-protocol';
import { ConfigRenderRegistry } from './config-item-render/config-render-registry';
import { customSerializerRegistry } from './config-item-render/custom-serializer-registry';
import styles from './index.less';
import { getDefaultValue, isStructConfigNode, typesMap } from './utils';

const layout = {
  labelCol: {
    span: 24,
  },
  wrapperCol: {
    span: 24,
  },
};

const hideSaveBtnCustomProtobufClsList = [
  // 分箱修改算子
  'Binning_modifications',
  // 线性模型参数修改算子
  'linear_model_pb2',
];

interface IConfigFormComponent {
  node: NodeAllInfo;
  onClose: () => void;
}

export const ConfigFormComponent: React.FC<IConfigFormComponent> = (prop) => {
  const { node, onClose } = prop;
  const {
    name: nodeName,
    nodeId,
    upstreamNodes,
    graphNode: savedNode,
    inputNodes,
  } = node;
  const { pathname, search } = useLocation();
  const { mode } = parse(search);

  const [form] = Form.useForm();
  const [componentConfig, setConfig] = useState<AtomicConfigNode[] | undefined>(
    undefined,
  );
  const [graphNode, setGraphNode] = useState<GraphNodeDetail>();
  const [isEditable, setIsEditable] = useState(true);
  const [isShowSaveBtn, setIsShowSaveBtn] = useState(true);
  const [translation, setTranslation] = useState({});

  const interpreter = useModel(DefaultComponentInterpreterService);
  const configRegistry = useModel(ComponentConfigRegistry);
  const componentConfigService = useModel(DefaultComponentConfigService);
  const projectEditService = useModel(ProjectEditService);

  const exif = {
    renderKey: codeNameRenderKey[nodeName as keyof typeof codeNameRenderKey],
    renderIndex: codeNameRenderIndex[nodeName as keyof typeof codeNameRenderIndex],
    hideIndex: hideCodeNameIndex[nodeName as keyof typeof hideCodeNameIndex],
    advancedConfigIndex:
      advancedConfigIndex[nodeName as keyof typeof advancedConfigIndex],
    upstreamTables:
      nodeName in getUpstreamKey
        ? getUpstreamKey[nodeName as keyof typeof getUpstreamKey](
            upstreamNodes,
            graphNode,
          )
        : graphNode?.inputs?.length
        ? graphNode?.inputs.concat(getInputTables(inputNodes))
        : getInputTables(inputNodes),
  };

  const [renderIndex, setRenderIndex] = useState(exif.renderIndex);

  useEffect(() => {
    const fetchConfig = () => {
      const configNode = componentConfigService.getComponentConfig(
        node,
        mode as ComputeMode,
      );
      setConfig(configNode);
    };
    const getTranslation = () => {
      const { version } = configRegistry.getComponentConfig(
        node.name,
        mode as ComputeMode,
      ) as StructConfigNode;

      setTranslation(
        interpreter.getComponentTranslationMap(
          `${node.name}:${version}`,
          mode as ComputeMode,
        ) || {},
      );
    };
    getTranslation();
    setGraphNode(savedNode);
    fetchConfig();
    setRenderIndex(exif.renderIndex);
  }, [node, nodeId, savedNode, mode]);

  useEffect(() => {
    if (pathname !== '/dag') setIsEditable(false);
    if (projectEditService.canEdit.configFormDisabled) {
      setIsEditable(false);
    } else {
      setIsEditable(true);
    }
  }, [pathname, projectEditService.canEdit.configFormDisabled]);

  useEffect(() => {
    /** 1. fetch 组件信息的时候，unserializer 反序列化，转换成表单需要的格式 */
    const fetchGraphNode = async () => {
      const { nodeDef } = graphNode || {};

      const initVal = await initFormVal();

      form.setFieldsValue(getGraphNodeAttrs(initVal.attrPaths, initVal.attrs));

      if (!nodeDef) return;

      const { attrs, attrPaths } = nodeDef;

      if (attrPaths && attrs) form.setFieldsValue(getGraphNodeAttrs(attrPaths, attrs));
    };

    // fetch 组件信息 所需 （2）getGraphNodeAttrs
    const getGraphNodeAttrs = (attrPaths: string[], attrs: Attribute[]) => {
      const ret: Record<string, Attribute> = {};

      attrPaths.forEach((path, index) => {
        const { is_na, custom_protobuf_cls, ...val } = attrs[index];

        // custom proto
        if (custom_protobuf_cls) {
          const attrVal = val;
          const { unserializer } = customSerializerRegistry[custom_protobuf_cls];

          ret[path] = unserializer(attrVal);
        } else {
          let attrVal = Object.values(val)[0];

          if (
            codeNameRenderKey[nodeName as keyof typeof codeNameRenderKey] ===
            'UNION_KEY_SELECT'
          )
            if (Array.isArray(attrVal) && attrVal.length === 0) attrVal = [null];
          if (!is_na) ret[path] = attrVal;
        }
      });

      // { output/output_ds: [] }
      return ret;
    };

    fetchGraphNode();
  }, [graphNode, form]);

  // fetch 组件信息 所需 （1）initFormVal
  const initFormVal = async () => {
    const params: { attrPaths: string[]; attrs: Attribute[] } = {
      attrPaths: [],
      attrs: [],
    };

    // serialize the params according to type
    componentConfig?.map((node: ConfigItem) => {
      if (!isStructConfigNode(node)) {
        const name =
          node.prefixes && node.prefixes.length > 0
            ? node.prefixes.join('/') + '/' + node.name
            : node.name;

        params.attrPaths.push(name);
        const { type } = node;

        if (hideSaveBtnCustomProtobufClsList.includes(node.custom_protobuf_cls)) {
          setIsShowSaveBtn(false);
        } else {
          setIsShowSaveBtn(true);
        }

        if (type === 'AT_CUSTOM_PROTOBUF') {
          const typeKey = node['custom_protobuf_cls'];
          const param: Record<string, ValueOf<Attribute>> = {};
          const { unserializer } = customSerializerRegistry[typeKey];

          const initVal = unserializer();

          param[typeKey] = initVal;

          params.attrs.push(param as Attribute);
        } else {
          const param: Record<string, ValueOf<Attribute>> = {};
          // typeKey = ss
          const typeKey = typesMap[type];

          // attrVal = []
          let attrVal: ValueOf<AtomicParameter> | undefined =
            typeKey === 'ss' ? [] : undefined;

          if (node.default_value) attrVal = node.default_value[typeKey];

          // {ss: []}
          param[typeKey] = attrVal;

          // attrs: [{ss: []}]
          params.attrs.push(param as Attribute);
        }
      }
    });

    return params;
  };

  /** 2. 把表单格式，serializer 序列化，转换成 node info */
  const onSaveConfig = async (val: Record<string, ValueOf<Attribute> | undefined>) => {
    /** （1）处理成传给服务端的配置 */
    const params: { attrPaths: string[]; attrs: Attribute[] } = {
      attrPaths: [],
      attrs: [],
    };

    /** （2）校验配置是否完成 */
    // serialize the params according to type
    let isFinished = true;

    const valKeys = Object.keys(val);
    componentConfig?.forEach((_node) => {
      const { type } = _node as AtomicConfigNode | CustomConfigNode;

      const name =
        _node.prefixes && _node.prefixes.length > 0
          ? _node.prefixes.join('/') + '/' + _node.name
          : _node.name;

      if (!valKeys.includes(name)) return;

      params.attrPaths.push(name);

      if (type === 'AT_CUSTOM_PROTOBUF') {
        const { custom_protobuf_cls } = _node as unknown as CustomConfigNode;
        const { serializer } = customSerializerRegistry[custom_protobuf_cls];
        const formattedVal = serializer(val[name], custom_protobuf_cls);

        params.attrs.push(formattedVal as Attribute);

        isFinished = true;
        return;
      }

      const param: Record<string, ValueOf<Attribute>> = {};
      const typeKey = typesMap[type];

      const attrVal =
        typeKey === 'ss' && !Array.isArray(val[name]) ? [val[name]] : val[name];
      const formedAttrVal = Array.isArray(attrVal) ? attrVal.filter((i) => i) : attrVal;

      param[typeKey] = formedAttrVal as ValueOf<Attribute>;

      let isNA = false;

      if (formedAttrVal === null || formedAttrVal === undefined) {
        isNA = true;
      }

      if (Array.isArray(formedAttrVal) && formedAttrVal.length === 0) {
        isNA = true;
      }

      /**
       * 假如当前配置节点是 isRequired，但是数据为空 isNA，就是未配置状态：isFinished = false
       */
      if ((_node as AtomicConfigNode).isRequired && isNA) {
        isFinished = false;
      }

      param['is_na'] = isNA;

      params.attrs.push(param as Attribute);
    });

    const { search } = window.location;
    const { projectId, dagId } = parse(search);

    componentConfigService.saveComponentConfig({
      projectId: projectId as string,
      graphId: dagId as string,
      isFinished,
      node: {
        ...graphNode,
        codeName: nodeName,
        graphNodeId: nodeId,
        nodeDef: {
          ...graphNode?.nodeDef,
          ...params,
        } as NodeDef,
      },
    });
  };

  const onFormFinished = (val: Record<string, ValueOf<Attribute> | undefined>) => {
    onSaveConfig(val);
    // close config drawer
    onClose();
  };

  // const handleFormChange = debounce(
  //   (_, allValues: Record<string, ValueOf<Attribute> | undefined>) => {
  //     form.validateFields().then(() => onSaveConfig(allValues));
  //   },
  //   500,
  // );

  const [advancedConfigOpen, setAdvancedConfigOpen] = useState(false);

  return (
    <div className={styles.configForm}>
      {componentConfig && componentConfig.length > 0 && isEditable && (
        <Alert
          key={'warning'}
          message="修改的内容需要保存才能生效，未保存退出则恢复至上次保存的配置"
          type="warning"
        />
      )}

      {componentConfig && componentConfig.length > 0 && (
        <Form
          {...layout}
          form={form}
          labelAlign={'left'}
          onFinish={() => onFormFinished(form.getFieldsValue())}
          disabled={!isEditable}
          // onValuesChange={handleFormChange}
          validateMessages={{ required: '「${label}」是必填字段' }}
          preserve={false}
        >
          {renderIndex
            ? renderIndex.map((order) => {
                // 开启了高级配置
                if (advancedConfigOpen) {
                  return (
                    <div key={order}>
                      {exif.advancedConfigIndex?.[0] === order ? (
                        <Button
                          type="link"
                          style={{ padding: 0, margin: '8px 0' }}
                          onClick={() => {
                            setAdvancedConfigOpen(!advancedConfigOpen);
                          }}
                        >
                          高级配置
                        </Button>
                      ) : null}
                      {exif.hideIndex?.includes(order) ? null : (
                        <ConfigurationNodeRender
                          form={form}
                          componentConfig={componentConfig}
                          config={componentConfig[order]}
                          node={node}
                          key={order}
                          index={order}
                          exif={exif}
                          translation={translation}
                          disabled={!isEditable}
                        />
                      )}
                    </div>
                  );
                } else {
                  return exif.hideIndex?.includes(order) ? null : (
                    <div key={order}>
                      {exif.advancedConfigIndex?.[0] === order ? (
                        <Button
                          type="link"
                          style={{ padding: 0, margin: '8px 0' }}
                          onClick={() => {
                            setAdvancedConfigOpen(!advancedConfigOpen);
                          }}
                        >
                          高级配置
                        </Button>
                      ) : null}
                      <ConfigurationNodeRender
                        style={{
                          display: !exif.advancedConfigIndex?.includes(order)
                            ? 'block'
                            : 'none',
                        }}
                        form={form}
                        componentConfig={componentConfig}
                        config={componentConfig[order]}
                        node={node}
                        key={order}
                        index={order}
                        exif={exif}
                        translation={translation}
                        disabled={!isEditable}
                      />
                    </div>
                  );
                }
              })
            : componentConfig.map((_, index) => {
                if (advancedConfigOpen) {
                  return (
                    <div key={index}>
                      {exif.advancedConfigIndex?.[0] === index ? (
                        <Button
                          type="link"
                          style={{ padding: 0, margin: '8px 0' }}
                          onClick={() => {
                            setAdvancedConfigOpen(!advancedConfigOpen);
                          }}
                        >
                          高级配置
                        </Button>
                      ) : null}
                      {exif.hideIndex?.includes(index) ? null : (
                        <ConfigurationNodeRender
                          form={form}
                          componentConfig={componentConfig}
                          config={componentConfig[index]}
                          node={node}
                          key={index}
                          index={index}
                          exif={exif}
                          translation={translation}
                          disabled={!isEditable}
                        />
                      )}
                    </div>
                  );
                } else {
                  return exif.hideIndex?.includes(index) ? null : (
                    <div key={index}>
                      <ConfigurationNodeRender
                        style={{
                          display: !exif.advancedConfigIndex?.includes(index)
                            ? 'block'
                            : 'none',
                        }}
                        form={form}
                        componentConfig={componentConfig}
                        config={componentConfig[index]}
                        node={node}
                        key={index}
                        index={index}
                        exif={exif}
                        translation={translation}
                        disabled={!isEditable}
                      />
                      {exif.advancedConfigIndex?.[0] === index ? (
                        <Button
                          type="link"
                          style={{ padding: 0, margin: '8px 0' }}
                          onClick={() => {
                            setAdvancedConfigOpen(!advancedConfigOpen);
                          }}
                        >
                          高级配置
                        </Button>
                      ) : null}
                    </div>
                  );
                }
              })}

          {isEditable && isShowSaveBtn && (
            <div className={styles.footer}>
              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" size="small">
                    保存配置
                  </Button>
                </Space>
              </Form.Item>
            </div>
          )}
        </Form>
      )}
    </div>
  );
};

export const ConfigurationNodeRender = ({
  form,
  node,
  config,
  exif,
  index,
  translation,
  style,
  disabled = false,
  componentConfig,
}: {
  form: FormInstance;
  config: AtomicConfigNode;
  node: NodeAllInfo;
  exif: Record<string, any>;
  index: number;
  translation: Record<string, string>;
  disabled?: boolean;
  style?: Record<any, any>;
  componentConfig: ConfigItem[];
}) => {
  const configRenderRegistry = useModel(ConfigRenderRegistry);
  const Render = configRenderRegistry.getRender(config, exif);

  const defaultVal = getDefaultValue(config);
  const { upstreamTables } = exif;

  const [value, setValue] = useState(defaultVal);

  return Render ? (
    <div className={styles.defaultRender} style={{ ...style }}>
      <Render
        form={form}
        value={value}
        defaultVal={defaultVal}
        componentConfig={componentConfig}
        node={config}
        nodeAllInfo={node}
        type={config.type}
        onChange={(val: ValueOf<Attribute> | undefined | null) => {
          setValue(val);
        }}
        upstreamTables={upstreamTables}
        index={index}
        translation={translation}
        disabled={disabled}
      />
    </div>
  ) : (
    <></>
  );
};
