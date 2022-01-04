import smtplib           
import re            
import seaborn as sns    
                        
sns.set_context("paper") 

class PDFReport:                                                                          
    def __init__(self, filename, dpi=400, figsize=[8.3, 11.7]):
        SMALL_SIZE = 6          
        MEDIUM_SIZE = 8
        BIGGER_SIZE = 10       
                                                            
        plt.rc('font', size=MEDIUM_SIZE)          # controls default text sizes
        plt.rc('axes', titlesize=SMALL_SIZE)     # fontsize of the axes title
        plt.rc('axes', labelsize=MEDIUM_SIZE)    # fontsize of the x and y labels
        plt.rc('xtick', labelsize=SMALL_SIZE)    # fontsize of the tick labels
        plt.rc('ytick', labelsize=SMALL_SIZE)    # fontsize of the tick labels
        plt.rc('legend', fontsize=SMALL_SIZE)    # legend fontsize
        plt.rc('figure', titlesize=BIGGER_SIZE)  # fontsize of the figure title
                         
        self.fileout = filename           
        self.pdf = PdfPages(self.fileout)
        self.fig = plt.figure(dpi=dpi, figsize=figsize)                        
        plt.style.use('seaborn-darkgrid')                       
        plt.tight_layout(pad=0.1, h_pad=0, w_pad=0)                                  

        plt.clf()         
                                                         
    def plot_table(self, ax, fig, tableData, title=None, auto_colour=False, font_size=None):
        if title is not None:
            plt.ylabel(title, labelpad=40)
                        
        plt.setp(ax.get_xticklabels(), visible=False)
        plt.setp(ax.get_yticklabels(), visible=False)                          
        plt.grid(False)                                
                                                                     
        cdict = {'red': ((0.0, 0.6, 0.6),
                         (0.4, 0.0, 0.0),
                         (1.0, 0.0, 0.0)),
                 'green': ((0.0, 0.0, 0.0),
                           (0.6, 0.0, 0.0),
                           (1.0, 0.6, 0.6)),
                 'blue': ((0.0, 0.0, 0.0),
                          (1.0, 0.0, 0.0))}

        rgCM = mpl.colors.LinearSegmentedColormap('rg', cdict, N=256)

        stripeColours = [[232 / 255, 239 / 255, 249 / 255, 1],
                         [200 / 255, 217 / 255, 241 / 255, 1],
                         [240 / 255, 217 / 255, 217 / 255, 1]]
        rowNameBgColours = np.ndarray((tableData.shape[0], 4))

        lastCol = 0
        for i in range(tableData.shape[0]):
            if re.match('[Tt]otal', tableData.index.values[i]):
                rowNameBgColours[i, :] = stripeColours[2]
                lastCol = 0
            else:
                rowNameBgColours[i, :] = stripeColours[lastCol]
                lastCol = 1 - lastCol

        # round numeric values and get colours for text
        def formatNum(x):
            if abs(x) > 999:
                x = round(x)
            else:
                x = round(x, 1)
            return f'{x:,}'

        scaledValues = pd.DataFrame()
        summaryStr = tableData.copy()
        for i in tableData.columns:
            thisData = tableData[i]
            if all(map(lambda x: isinstance(x, float), thisData)):
                scaledValues[i] = list(thisData / np.abs(thisData).max())
                summaryStr[i] = list(map(formatNum, thisData))
        cellTextColours = rgCM(scaledValues)

        # background colour striping
        cellBgColours = np.zeros((tableData.shape[0], tableData.shape[1], 4))
        for i in range(tableData.shape[1]):
            cellBgColours[:, i] = rowNameBgColours

        fig.patch.set_visible(False)  # hide axes
        ax.set_fc([0, 0, 0, 0])  # remove backgroud fill, by setting it to be transparent

        table = ax.table(cellText=summaryStr.values, loc='center right',
                         rowColours=rowNameBgColours,
                         colLabels=tableData.columns.values,
                         rowLabels=tableData.index.values,
                         cellColours=cellBgColours)

        for ind, cell in table._cells.items():
            if (ind[0] == 0) or (ind[1] < 0):
                cell.set_text_props(weight='bold', color='w')
                cell.set_edgecolor('w')
                cell.set_facecolor([74 / 255, 126 / 255, 207 / 255, 1])
                cell.PAD = 0.1
            if '\n' in cell.get_text().get_text():
                cell.set_height(cell.get_height() * 2)

        for x in range(tableData.shape[1]):
            for y in range(tableData.shape[0]):
                if auto_colour:
                    table[1 + y, x].get_text().set_color(cellTextColours[y, x])

                table[1 + y, x].set_edgecolor('w')

        if font_size is not None:
            table.set_fontsize(font_size)
            table.scale(font_size/8, 1)

        table.auto_set_font_size(False)
        table.auto_set_column_width(col=list(range(len(tableData.columns))))

ef plot_timeseries(self, ax, fig, pltData, log_scale=False, ylabel=None, xaxis=True):
   if log_scale:                                          
       ax.set_yscale('log')
                  
   plt.xticks(rotation=90)
   ax.xaxis.set_major_formatter(DateFormatter("%d %b"))
                                                                          
   if ylabel is not None:                                               
       plt.ylabel(ylabel)                                                   
                                                                         
   if not xaxis:                                                         
       plt.setp(ax.get_xticklabels(), visible=False)         
                                                                          
   plt.plot(pltData)
   plt.legend(pltData.columns.values)
