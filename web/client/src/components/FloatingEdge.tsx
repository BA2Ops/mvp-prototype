import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  Position,
  type EdgeProps,
  type Node as RFNode
} from 'reactflow'

/**
 * 根据两个节点的相对位置,计算最佳连接点和坐标
 */
function getEdgeParams(
  source: RFNode,
  target: RFNode
): { sx: number; sy: number; tx: number; ty: number; sourcePos: Position; targetPos: Position } {
  const sx = source.positionAbsolute?.x ?? source.position.x
  const sy = source.positionAbsolute?.y ?? source.position.y
  const tx = target.positionAbsolute?.x ?? target.position.x
  const ty = target.positionAbsolute?.y ?? target.position.y

  // 节点实际渲染尺寸(可能因内容撑开而大于估算值)
  const sw = source.width ?? 260
  const sh = source.height ?? 80
  const tw = target.width ?? 260
  const th = target.height ?? 80

  const sourceHalfW = sw / 2
  const sourceHalfH = sh / 2
  const targetHalfW = tw / 2
  const targetHalfH = th / 2

  const sourceCenterX = sx + sourceHalfW
  const sourceCenterY = sy + sourceHalfH
  const targetCenterX = tx + targetHalfW
  const targetCenterY = ty + targetHalfH

  const dx = targetCenterX - sourceCenterX
  const dy = targetCenterY - sourceCenterY

  // 根据相对位置选择最佳连接边
  let sourcePos: Position
  let targetPos: Position

  if (Math.abs(dx) > Math.abs(dy)) {
    // 水平方向为主
    if (dx > 0) {
      sourcePos = Position.Right
      targetPos = Position.Left
    } else {
      sourcePos = Position.Left
      targetPos = Position.Right
    }
  } else {
    // 垂直方向为主
    if (dy > 0) {
      sourcePos = Position.Bottom
      targetPos = Position.Top
    } else {
      sourcePos = Position.Top
      targetPos = Position.Bottom
    }
  }

  // 计算连接点坐标
  const sourcePosOffsets = {
    [Position.Left]: { x: sx, y: sourceCenterY },
    [Position.Right]: { x: sx + sourceHalfW * 2, y: sourceCenterY },
    [Position.Top]: { x: sourceCenterX, y: sy },
    [Position.Bottom]: { x: sourceCenterX, y: sy + sourceHalfH * 2 }
  }
  const targetPosOffsets = {
    [Position.Left]: { x: tx, y: targetCenterY },
    [Position.Right]: { x: tx + targetHalfW * 2, y: targetCenterY },
    [Position.Top]: { x: targetCenterX, y: ty },
    [Position.Bottom]: { x: targetCenterX, y: ty + targetHalfH * 2 }
  }

  return {
    sx: sourcePosOffsets[sourcePos].x,
    sy: sourcePosOffsets[sourcePos].y,
    tx: targetPosOffsets[targetPos].x,
    ty: targetPosOffsets[targetPos].y,
    sourcePos,
    targetPos
  }
}

export interface FloatingEdgeData {
  stroke: string
  dashed?: boolean
  labelColor: string
  offset?: number  // 双向边分离偏移(正/负),0 表示无偏移
}

export default function FloatingEdge({
  id,
  source,
  target,
  label,
  data,
  markerEnd
}: EdgeProps) {
  const { getNode } = useReactFlow()
  const sourceNode = getNode(source)
  const targetNode = getNode(target)

  if (!sourceNode || !targetNode) {
    return null
  }

  const edgeData = data as FloatingEdgeData | undefined
  const stroke = edgeData?.stroke ?? '#6366f1'
  const dashed = edgeData?.dashed
  const labelColor = edgeData?.labelColor ?? stroke
  const offset = edgeData?.offset ?? 0

  const params = getEdgeParams(sourceNode, targetNode)

  // 双向边偏移:沿垂直于主轴方向平移连接点,使平行曲线分离
  const OFFSET_PX = 20
  let sx = params.sx
  let sy = params.sy
  let tx = params.tx
  let ty = params.ty
  if (offset !== 0) {
    const isHorizontal = params.sourcePos === Position.Left || params.sourcePos === Position.Right
    if (isHorizontal) {
      sy += offset * OFFSET_PX
      ty += offset * OFFSET_PX
    } else {
      sx += offset * OFFSET_PX
      tx += offset * OFFSET_PX
    }
  }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: params.sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: params.targetPos
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: 2,
          strokeDasharray: dashed ? '5 5' : undefined
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 11,
              fontWeight: 600,
              fill: labelColor,
              color: labelColor,
              pointerEvents: 'none',
              background: 'rgba(255,255,255,0.85)',
              padding: '1px 4px',
              borderRadius: 3
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
