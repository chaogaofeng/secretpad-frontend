import type { DAG } from '@secretflow/dag';
import { splitPortId, Portal, ShowMenuContext } from '@secretflow/dag';
import { useSize } from 'ahooks';
import { Empty, Tooltip } from 'antd';
import classnames from 'classnames';
import { parse } from 'query-string';
import React from 'react';
import { useLocation } from 'umi';

import templateImg from '@/assets/dag-background.svg';
import { getModel, Model, useModel } from '@/util/valtio-helper';

import { DefaultComponentInterpreterService } from '../component-interpreter/component-interpreter-service';
import { DefaultComponentTreeService } from '../component-tree/component-tree-service';
import { DagLogService } from '../dag-log/dag-log.service';
import { DefaultModalManager } from '../dag-modal-manager';
import { RecordListDrawerItem } from '../pipeline-record-list/record-list-drawer-view';

import mainDag from './dag';
import styles from './index.less';
import { createPortTooltip } from './util';

// const ProgressContext = React.createContext(30);
const X6ReactPortalProvider = Portal.getProvider(); // 注意，一个 graph 只能申明一个 portal provider

export const GraphComponents: React.FC<{
  viewInstance?: GraphView;
  dagInstatnce?: DAG;
}> = (props: { viewInstance?: GraphView; dagInstatnce?: DAG }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewInstance = props?.viewInstance || useModel(GraphView);
  const dagInstatnce = props?.dagInstatnce || mainDag;
  const modalManager = useModel(DefaultModalManager);
  const { search, pathname } = useLocation();
  const dagId = parse(search)?.dagId as string;

  const viewRef = React.useRef<HTMLDivElement>(null);
  const { width, height } = useSize(viewRef.current) || {};

  React.useEffect(() => {
    dagInstatnce.dispose();
    if (dagId && containerRef.current) {
      modalManager.closeAllModalsBut(RecordListDrawerItem.id);
      viewInstance.initGraph(dagId, containerRef.current);
    }
  }, [dagId]);

  React.useEffect(() => {
    const graph = dagInstatnce.graphManager.getGraphInstance();
    if (graph && width && height) {
      graph.resize(width, height);
    }
  }, [width, height]);

  return (
    <div className={styles.container} ref={viewRef}>
      {!dagId && (
        <div className={styles.empty}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无训练流，请在左侧面板新建一个"
          />
        </div>
      )}
      <ShowMenuContext.Provider value={pathname === '/dag'}>
        <X6ReactPortalProvider />
      </ShowMenuContext.Provider>
      <div ref={containerRef} className={classnames(styles.graph, 'x6-graph')} />
      <Tooltip
        title="content"
        overlayClassName="main-widget-tooltip"
        open={true}
        arrow={true}
        placement="top"
      >
        <span style={{ position: 'relative', left: -1000, top: -1000 }} />
      </Tooltip>
    </div>
  );
};

export class GraphView extends Model {
  componentService = getModel(DefaultComponentTreeService);

  componentInterpreter = getModel(DefaultComponentInterpreterService);

  logService = getModel(DagLogService);

  onViewUnMount() {
    mainDag.dispose();
  }

  initGraph(dagId: string, container: HTMLDivElement) {
    if (container) {
      const { clientWidth, clientHeight } = container;
      mainDag.init(
        dagId,
        {
          container: container,
          width: clientWidth,
          height: clientHeight,
          background: { image: templateImg as any, position: '50% 30%' },
          onPortRendered: async ({ contentContainer, port, node }) => {
            const { codeName } = node.getData();
            const [domain, name] = codeName.split('/');
            const { type, index } = splitPortId(port.id);
            const component = await this.componentService.getComponentConfig({
              domain,
              name,
            });

            if (component) {
              const interpretion = this.componentInterpreter.getComponentTranslationMap(
                {
                  domain,
                  name,
                  version: component.version,
                },
              );
              const ioType = type === 'input' ? 'inputs' : 'outputs';
              const des = component?.[ioType]?.[index].desc;
              createPortTooltip(
                contentContainer,
                (interpretion ? interpretion[des] : undefined) || des,
                'main-widget-tooltip',
              );
            }
          },
        },
        'FULL',
      );
    }
  }
}