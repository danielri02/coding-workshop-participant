import { Box } from '@mui/material'
import { DataGrid, GridToolbar, type DataGridProps, type GridValidRowModel } from '@mui/x-data-grid'

/** Shared grid sizing, controls and native horizontal scrolling for CRUD and reports. */
export function DataTable<Row extends GridValidRowModel>(props: DataGridProps<Row>) {
  return (
    <Box sx={{ height: 'clamp(300px, calc(100dvh - 300px), 590px)', width: '100%', minWidth: 0 }}>
      <DataGrid
        scrollbarSize={14}
        disableRowSelectionOnClick
        pageSizeOptions={[10, 25, 50, 100]}
        showToolbar
        slots={{ toolbar: GridToolbar }}
        slotProps={{
          toolbar: {
            showQuickFilter: false,
            csvOptions: { disableToolbarButton: true },
            printOptions: { disableToolbarButton: true },
          },
        }}
        localeText={{
          noRowsLabel: 'No records to show',
          noResultsOverlayLabel: 'No records match these filters',
        }}
        sx={{
          border: 0,
          minWidth: 0,
          maxWidth: '100%',
          '& .MuiDataGrid-columnHeaders': { fontSize: 12, color: 'text.secondary' },
          '& .MuiDataGrid-cell': { borderColor: 'divider' },
          '& .MuiDataGrid-toolbarContainer': {
            px: 2,
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexWrap: 'wrap',
          },
          '& .MuiDataGrid-scrollbar--horizontal': {
            overflowX: 'scroll',
            '&::-webkit-scrollbar': { height: 14 },
            '&::-webkit-scrollbar-thumb': { bgcolor: '#a9b6c8', borderRadius: 7 },
            '&::-webkit-scrollbar-track': { bgcolor: '#edf1f7' },
          },
          '& .MuiTablePagination-selectLabel': { display: { xs: 'none', sm: 'block' } },
        }}
        {...props}
      />
    </Box>
  )
}
