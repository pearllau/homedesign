(function (root) {
  'use strict';

  // This is an inferred topology for text-only plans, not a reconstruction of
  // an uploaded drawing. Solid rooms retain their area; circulation is a
  // placeholder inside the public hub and never creates extra floor area.
  const isBathroom = name => /卫|浴|洗手间|盥洗|bath|toilet|wc\b/i.test(name);
  const isSuiteBath = name => /主.*(?:卫|浴)|套.*(?:卫|浴)|ensuite|en.suite|master.*bath/i.test(name);
  const isKitchen = name => /厨|kitchen|\bldk\b/i.test(name);
  const isBedroom = name => /卧|儿童房|小孩房|老人房|子女房|bedroom/i.test(name);
  const isHub = name => /客厅|起居|客餐|客饭|living|ldk/i.test(name);
  const isDining = name => /餐厅|dining/i.test(name);
  const isBalcony = name => /阳台|露台|balcony|terrace/i.test(name);
  const isVirtual = name => /走廊|过道|走道|玄关|门厅|公共通道|corridor|foyer|hallway/i.test(name);
  const areaOf = room => room.w * room.l * 1000000;
  const sumArea = units => units.reduce((total, unit) => total + unit.area, 0);
  const rounded = number => Math.round(number * 100) / 100;

  function build(src, origin, wallThickness, options) {
    if (!Array.isArray(src) || !src.length) return null;
    const allItems = src.map((room, key) => ({ key, name: String(room && room.name || '房间'), w: Number(room && room.w), l: Number(room && room.l), source: room }));
    const virtualInputs = allItems.filter(room => isVirtual(room.name));
    const items = allItems.filter(room => !isVirtual(room.name));
    if (!items.length) return null;
    if (items.some(room => !Number.isFinite(room.w) || !Number.isFinite(room.l) || room.w <= 0 || room.l <= 0)) return null;
    const centerX = Number.isFinite(origin && origin.x) ? origin.x : 0;
    const centerY = Number.isFinite(origin && origin.y) ? origin.y : 0;
    const thickness = Math.max(0, Number(wallThickness) || 0);
    const passageWidth = Math.max(1200, 1000 + thickness);
    if (items.length === 1) {
      const width = items[0].w * 1000, height = items[0].l * 1000;
      return { rooms: [{ key: items[0].key, rect: [centerX - width / 2, centerY - height / 2, centerX + width / 2, centerY + height / 2] }], virtualZones: [], width, height, allowedConnections: [], entryKey: items[0].key, valid:true, issues:[], warnings: ['单空间方案需在公共区内安排厨房、卫浴和家政功能；未伪造独立房间。'] };
    }

    const warnings = [];
    const totalArea = Math.max(0, Number(options?.totalArea) || 0) * 1000000;
    const sourceArea = items.reduce((sum, room) => sum + areaOf(room), 0);
    const roomBudget = totalArea || sourceArea;
    let addedArea = 0;
    if (totalArea && sourceArea > totalArea) warnings.push('现有房间面积已超过建筑面积，未补造新功能房间；请核对输入尺寸。');
    const addRoom = (name, minimumArea) => {
      if (items.some(room => name === '厨房' ? isKitchen(room.name) : name === '生活阳台' ? isBalcony(room.name) || /家政|洗衣区|laundry|utility/i.test(room.name) : name === '主卫' ? isSuiteBath(room.name) : name === '公卫' ? isBathroom(room.name) && !isSuiteBath(room.name) : false)) return null;
      if (sourceArea + addedArea + minimumArea * 1000000 > roomBudget + 1) {
        warnings.push(`总面积不足以增加${name}，未伪造额外面积；请在方案中补充空间预算后重试。`);
        return null;
      }
      const side = Math.sqrt(minimumArea);
      const room = {key:`inferred:${name}`,name,w:side,l:side,source:{name,width:side,length:side,area:minimumArea,furniture:[],notes:'根据功能完整性补全，需确认实际尺寸。'},inferred:true};
      items.push(room); addedArea += areaOf(room); warnings.push(`已为文字方案补充${name}（${minimumArea}㎡，暂按紧凑尺寸估算），请确认真实面积。`);
      return room;
    };
    addRoom('厨房', 4);
    addRoom('生活阳台', 2.5);
    const bedrooms = items.filter(room => isBedroom(room.name) && !isBathroom(room.name));
    const baths = items.filter(room => isBathroom(room.name));
    const targetBaths = bedrooms.length >= 3 ? 2 : 1;
    const bathArea = baths.reduce((sum, room) => sum + areaOf(room), 0);
    if (totalArea && bathArea > totalArea * .15) warnings.push('卫生间面积超过总面积 15%，保留用户给定房间并标记为需调整，未再补卫浴。');
    else while (baths.length < targetBaths) {
      const name = bedrooms.length >= 3 && !baths.some(room=>isSuiteBath(room.name)) ? '主卫' : '公卫';
      const inferred = addRoom(name, 3.5);
      if (!inferred) break;
      baths.push(inferred);
    }
    const completedArea = items.reduce((sum, room) => sum + areaOf(room), 0);
    if (totalArea && completedArea > totalArea + 1) warnings.push('功能补全后超过建筑面积上限，自动布局无效；请减少房间面积或调整需求。');
    const hubCandidates = items.filter(room => isHub(room.name) && !isKitchen(room.name));
    const diningCandidates = items.filter(room => isDining(room.name) && !isKitchen(room.name));
    const hub = (hubCandidates.length ? hubCandidates : diningCandidates).sort((a,b)=>areaOf(b)-areaOf(a))[0] || null;
    const publicRooms = items.filter(room => room === hub || (isDining(room.name) && !isKitchen(room.name)) || (isHub(room.name) && !isKitchen(room.name)));
    const publicKeys = publicRooms.map(room=>room.key);
    if(virtualInputs.length)warnings.push('玄关和走廊仅作为公共区内的虚拟占位，不独立砌墙，也不额外增加客餐厅面积。');
    const publicArea = publicRooms.reduce((sum,room)=>sum+areaOf(room),0);
    const remaining = items.filter(room=>!publicKeys.includes(room.key));
    const pairs = new Map(), pairedChildren = new Set();
    const sleepingRooms = remaining.filter(room=>isBedroom(room.name)&&!isBathroom(room.name))
      .sort((a,b)=>Number(/主卧|主人|master/i.test(b.name))-Number(/主卧|主人|master/i.test(a.name))||areaOf(b)-areaOf(a));
    remaining.filter(room=>isSuiteBath(room.name)&&isBathroom(room.name)).forEach(bath=>{
      const parent=sleepingRooms.find(room=>!pairs.has(room.key));
      if(parent){pairs.set(parent.key,bath);pairedChildren.add(bath.key);}
      else warnings.push(`${bath.name}缺少可匹配的卧室，无法推断套内入口；请补充房间关系后确认。`);
    });
    const balconies=remaining.filter(room=>isBalcony(room.name)||/家政|洗衣区|laundry|utility/i.test(room.name));
    remaining.filter(room=>isKitchen(room.name)).forEach(kitchen=>{
      const child=balconies.find(room=>!pairedChildren.has(room.key));
      if(child){pairs.set(kitchen.key,child);pairedChildren.add(child.key);}
    });
    const units=remaining.filter(room=>!pairedChildren.has(room.key)).map(room=>{
      const child=pairs.get(room.key),group=child?[room,child]:[room];
      return {items:group,area:group.reduce((sum,item)=>sum+areaOf(item),0),kitchen:isKitchen(room.name),bathroom:group.some(item=>isBathroom(item.name)),bedroom:isBedroom(room.name)};
    });
    const inferredArea=items.reduce((sum,room)=>sum+areaOf(room),0);
    // Search compact candidates. All public space is a usable central band;
    // there is no separate circulation strip subtracted from the living room.
    const flexible=units.filter(unit=>!unit.kitchen&&!unit.bathroom);
    const assignmentCount=2**Math.min(flexible.length,10);
    let best=null;
    const reference=Math.sqrt(Math.max(inferredArea,1));
    for(let mask=0;mask<assignmentCount;mask++){
      const left=units.filter(unit=>unit.kitchen),right=units.filter(unit=>unit.bathroom&&!unit.kitchen);
      flexible.forEach((unit,index)=>((mask>>index)&1?left:right).push(unit));
      const bankAreas=[sumArea(left),sumArea(right)];
      for(let step=0;step<=80;step++){
        const height=reference*(.72+step*.007);
        const centerWidth=publicArea/height,width=inferredArea/height;
        const sideWidths=bankAreas.map(value=>value/height);
        if(!hub||centerWidth<Math.max(1200,Math.min(3000,Math.sqrt(publicArea)*.6)))continue;
        const ratio=Math.max(width/height,height/width);
        let score=Math.log(ratio)**2*65 + Math.max(0,ratio-1.65)**2*100;
        publicRooms.forEach(room=>{
          const usable=areaOf(room),depth=usable/centerWidth;
          const wanted=isDining(room.name)&&!isHub(room.name)?2200:2800;
          score+=Math.max(0,wanted-Math.min(centerWidth,depth))**2/200000;
          score+=Math.log(Math.max(centerWidth,depth)/Math.min(centerWidth,depth))**2*2;
        });
        [left,right].forEach((bank,index)=>bank.forEach(unit=>unit.items.forEach(room=>{
          const rw=sideWidths[index],rh=areaOf(room)/rw;
          const minimum=isBathroom(room.name)?1100:isBalcony(room.name)?900:isBedroom(room.name)?Math.min(2400,Math.sqrt(areaOf(room))*.8):isKitchen(room.name)?1700:1200;
          score+=Math.max(0,minimum-Math.min(rw,rh))**2/120000;
          const wanted=Math.max(room.w/room.l,room.l/room.w);
          score+=Math.log(Math.max(rw/rh,rh/rw)/wanted)**2*2;
        })));
        if(!best||score<best.score)best={left,right,height,width,centerWidth,sideWidths,score};
      }
    }
    if(!best){
      return {rooms:items.map(room=>({key:room.key,name:room.name,source:room.source,rect:[0,0,room.w*1000,room.l*1000]})),virtualZones:[],publicKeys,entryKey:hub?.key??null,width:reference,height:reference,allowedConnections:[],directedEdges:[],valid:false,issues:['公共活动面积不足或缺少客餐厅，无法建立有效布局。'],warnings:[...warnings,'公共活动面积不足或缺少客餐厅，无法建立有效布局。']};
    }
    const {height,width,centerWidth,sideWidths}=best;
    const x0=centerX-width/2,y0=centerY-height/2,x1=x0+width,y1=y0+height;
    const publicLeft=x0+sideWidths[0],publicRight=publicLeft+centerWidth;
    const rooms=[],allowedConnections=[];
    // Living sits at the entry edge. Dining stays open to it: shared edges
    // between these public polygons generate neither walls nor door leaves.
    const orderedPublic=publicRooms.filter(room=>room!==hub).concat(hub?[hub]:[]);
    let current=y0;
    orderedPublic.forEach((room,index)=>{
      const next=index===orderedPublic.length-1?y1:current+areaOf(room)/centerWidth;
      rooms.push({key:room.key,name:room.name,source:room===hub?{...room.source,furniture:[...(room.source.furniture||[]),...virtualInputs.filter(item=>/玄关|门厅|foyer/i.test(item.name)).flatMap(item=>item.source.furniture||[])]}:room.source,rect:[publicLeft,current,publicRight,next],public:true});
      current=next;
    });
    const attachToPublic=room=>{
      const r=room.rect;
      const overlap=item=>Math.max(0,Math.min(item.rect[3],r[3])-Math.max(item.rect[1],r[1]));
      const candidates=rooms.filter(item=>item.public&&overlap(item)>=1100);
      // Prefer an entrance at the upper end of a room, leaving a continuous
      // solid wall for beds/cabinets instead of cutting its centre in half.
      return (candidates.length?candidates:rooms.filter(item=>item.public)).sort((a,b)=>Math.max(a.rect[1],r[1])-Math.max(b.rect[1],r[1])||overlap(b)-overlap(a))[0];
    };
    const fillBank=(bank,left,right)=>{
      const order=bank.slice().sort((a,b)=>Number(b.kitchen)-Number(a.kitchen)||Number(b.bedroom)-Number(a.bedroom)||b.area-a.area);
      let start=y0;
      order.forEach((unit,unitIndex)=>{
        // Put an ensuite at the far end of its suite and a service balcony at
        // the far end of the kitchen. Each parent has its own public entrance.
        const list=unit.items.length===2?[unit.items[1],unit.items[0]]:unit.items;
        list.forEach((room,itemIndex)=>{
          const end=unitIndex===order.length-1&&itemIndex===list.length-1?y1:start+areaOf(room)/(right-left);
          const placed={key:room.key,name:room.name,source:room.source,rect:[left,start,right,end]};
          rooms.push(placed);
          if(pairedChildren.has(room.key))allowedConnections.push([unit.items[0].key,room.key]);
          else if(!isSuiteBath(room.name)){const parent=attachToPublic(placed);if(parent)allowedConnections.push([parent.key,room.key]);}
          start=end;
        });
      });
    };
    if(best.left.length)fillBank(best.left,x0,publicLeft);
    if(best.right.length)fillBank(best.right,publicRight,x1);
    rooms.forEach(room=>{room.rect=room.rect.map(rounded);});
    // Keep the inferred entrance near a side wall so that its foyer has a
    // usable wall anchor rather than floating in the centre of a wide hub.
    const entryCenter=[rounded(publicLeft+Math.min(1250,centerWidth/2)),rounded(y1)];
    const entryRoom=rooms.find(room=>room.key===hub.key);
    const virtualZones=[
      {id:'circulation',kind:'navmesh',hosts:publicKeys,width:1000},
      {id:'foyer',kind:'foyer',anchor:'entry',maxDistance:2000,rect:[Math.max(publicLeft,entryCenter[0]-1500),Math.max(entryRoom.rect[1],entryCenter[1]-1500),Math.min(publicRight,entryCenter[0]+750),entryCenter[1]].map(rounded)},
    ];
    warnings.push('文字方案的入户门暂设在客厅底部外墙，实际门位需按原始户型确认。');
    const layout={version:4,rooms,virtualZones,publicKeys,entryAnchor:{center:entryCenter,side:'bottom',inferred:true},entryKey:hub.key,width:rounded(width),height:rounded(height),exterior:[x0,y0,x1,y1].map(rounded),areaLimit:totalArea||null,allowedConnections,directedEdges:allowedConnections.map(([from,to])=>({from,to})),corridorWidth:passageWidth,warnings};
    const issues=validate(layout,src);
    return {...layout,valid:issues.length===0,issues,warnings:[...new Set([...warnings,...issues])]};
  }

  function validate(layout, source) {
    const issues = [], rootKey=layout.entryKey, rooms=layout.rooms||[], edges=layout.allowedConnections||[];
    const nameOf = key => rooms.find(room=>room.key===key)?.name || source?.[key]?.name || '';
    const outgoing = key => edges.filter(edge=>edge[0]===key).map(edge=>edge[1]);
    const roots=layout.publicKeys?.length?layout.publicKeys:rootKey==null?[]:[rootKey];
    if(roots.some(key=>!isHub(nameOf(key))&&!isDining(nameOf(key))))issues.push('公共枢纽只能包含客厅、餐厅等开放公共空间。');
    if(rootKey!=null&&!roots.includes(rootKey))issues.push('入户门必须直接接入公共枢纽。');
    if(rooms.length>1){
      if(!layout.entryAnchor)issues.push('多房间方案缺少入户门锚点。');
      if(!(layout.virtualZones||[]).some(zone=>zone.kind==='foyer'))issues.push('多房间方案缺少与入户门绑定的虚拟玄关。');
      if(!(layout.virtualZones||[]).some(zone=>zone.kind==='navmesh'&&zone.width>=1000))issues.push('公共动线必须保留至少 1000 mm 宽的寻路网格。');
    }
    const depth = new Map(roots.map(key=>[key,0])), queue=roots.slice();
    for(let head=0;head<queue.length;head++) for(const child of outgoing(queue[head])){
      const level=depth.get(queue[head])+1;
      if(depth.has(child)){issues.push(`${nameOf(child)||'房间'}存在重复父节点或环路。`);continue;}
      depth.set(child,level);queue.push(child);
      if(level>2)issues.push(`${nameOf(child)||'房间'}超过 Hub → Room → Sub-room 两级深度。`);
      if(level===2 && !((isBedroom(nameOf(queue[head]))&&isSuiteBath(nameOf(child))) || (isKitchen(nameOf(queue[head]))&&/阳台|家政|洗衣|laundry|balcony/i.test(nameOf(child))))) issues.push(`${nameOf(child)||'房间'}不能经其他实体房间串联进入。`);
    }
    rooms.forEach(room=>{
      if(!depth.has(room.key))issues.push(`${nameOf(room.key)||'房间'}未接入公共枢纽。`);
      const name=nameOf(room.key),r=room.rect,e=layout.exterior;
      if(isSuiteBath(name)){
        const parents=edges.filter(edge=>edge[1]===room.key).map(edge=>nameOf(edge[0]));
        if(parents.length!==1||!isBedroom(parents[0])||isBathroom(parents[0]))issues.push(`${name}只能通过卧室内部的唯一入口进入。`);
      }
      if(e && ((isBedroom(name)&&!isBathroom(name))||isBalcony(name))){
        const edges=[Math.abs(r[0]-e[0])<1?r[3]-r[1]:0,Math.abs(r[1]-e[1])<1?r[2]-r[0]:0,Math.abs(r[2]-e[2])<1?r[3]-r[1]:0,Math.abs(r[3]-e[3])<1?r[2]-r[0]:0];
        if(Math.max(...edges)<800)issues.push(`${name}没有至少 800 mm 的可用外墙采光边。`);
      }
      if(isVirtual(name))issues.push(`${name}必须作为公共空间内的虚拟区块。`);
    });
    const rectArea=rect=>(rect[2]-rect[0])*(rect[3]-rect[1]);
    const overlap=(a,b)=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
    const validRect=rect=>Array.isArray(rect)&&rect.length===4&&rect.every(Number.isFinite)&&rect[2]>rect[0]&&rect[3]>rect[1];
    const publicRooms=rooms.filter(room=>roots.includes(room.key));
    const anchor=layout.entryAnchor?.center,entryRoom=rooms.find(room=>room.key===rootKey);
    if(layout.entryAnchor && (!entryRoom||!Array.isArray(anchor)||anchor.length!==2||!anchor.every(Number.isFinite)||Math.abs(anchor[1]-entryRoom.rect[3])>1||anchor[0]<entryRoom.rect[0]+450||anchor[0]>entryRoom.rect[2]-450||Math.abs(anchor[1]-layout.exterior?.[3])>1))issues.push('入户锚点必须位于公共枢纽的底部外墙，且留出完整门洞。');
    for(const zone of layout.virtualZones||[]){
      if(zone.kind==='navmesh'&&!zone.rect)continue;
      if(!validRect(zone.rect)){issues.push('虚拟区块缺少有效范围。');continue;}
      const covered=publicRooms.reduce((sum,room)=>sum+overlap(room.rect,zone.rect),0);
      if(covered<rectArea(zone.rect)-100)issues.push('玄关或动线虚拟区块超出了公共枢纽。');
      if(zone.kind==='foyer'&&(!anchor||Math.hypot((zone.rect[0]+zone.rect[2])/2-anchor[0],(zone.rect[1]+zone.rect[3])/2-anchor[1])>2000))issues.push('玄关虚拟区块距离入户门超过 2 米。');
    }
    rooms.forEach((room,index)=>{
      if(!validRect(room.rect)){issues.push(`${nameOf(room.key)}的房间边界无效。`);return;}
      if(layout.exterior&&overlap(room.rect,layout.exterior)<rectArea(room.rect)-100)issues.push(`${nameOf(room.key)}超出建筑外轮廓。`);
      rooms.slice(index+1).forEach(other=>{if(overlap(room.rect,other.rect)>100)issues.push(`${nameOf(room.key)}与${nameOf(other.key)}的房间范围重叠。`);});
    });
    if(layout.areaLimit&&rooms.reduce((sum,room)=>sum+rectArea(room.rect),0)>layout.areaLimit+1000)issues.push('实体房间面积超过建筑面积，需重新分配空间。');
    edges.forEach(([from,to])=>{
      const a=rooms.find(room=>room.key===from)?.rect,b=rooms.find(room=>room.key===to)?.rect;
      if(!a||!b)return issues.push('房间连接引用不存在的空间。');
      const overlapY=Math.min(a[3],b[3])-Math.max(a[1],b[1]),overlapX=Math.min(a[2],b[2])-Math.max(a[0],b[0]);
      const shared=((Math.abs(a[0]-b[2])<1||Math.abs(a[2]-b[0])<1)&&overlapY>=850)||((Math.abs(a[1]-b[3])<1||Math.abs(a[3]-b[1])<1)&&overlapX>=850);
      if(!shared)issues.push(`${nameOf(from)}与${nameOf(to)}缺少可开门的公共边。`);
    });
    return [...new Set(issues)];
  }
  root.FunctionalTopology = Object.freeze({ build, validate });
})(typeof globalThis === 'object' ? globalThis : window);
